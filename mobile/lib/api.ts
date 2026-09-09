import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

import { getApiBaseUrl } from './config';
import type {
  AskResponse,
  ChatMessage,
  Course,
  CourseCreateInput,
  CourseDetail,
  CourseUpdateInput,
  ExamAdmin,
  ExamAnswerSubmit,
  ExamCreateInput,
  ExamStartResult,
  ExamStatus,
  ExamSubmitResult,
  ExamUpdateInput,
  Instructor,
  LessonAccessCode,
  LessonCreateInput,
  LessonDetail,
  LessonUpdateInput,
  LessonViewInfo,
  ProgressEntry,
  RedeemCodeResult,
  Question,
  QuestionAdmin,
  QuestionAttemptResult,
  QuestionCreateInput,
  QuestionUpdateInput,
  Subject,
  SubjectDetail,
  Teacher,
  TeacherCreateInput,
  TeacherUpdateInput,
  UsageInfo,
  User,
} from './types';

const TOKEN_KEY = 'physics_platform_access_token';
// Remembers which chat session the Assistant tab was last showing, so
// re-opening the app (or just the tab) resumes the same conversation
// instead of starting over every time — see app/(tabs)/assistant.tsx.
const ASSISTANT_SESSION_KEY = 'physics_platform_assistant_session_id';
// Remembers the student's chosen app UI language (Arabic/English — this is
// the app's own chrome: buttons, placeholders, error messages — not the AI
// Assistant's answers, which already follow whatever language the question
// was asked in) so it doesn't reset every time the app is reopened. Shared
// by every student-facing screen via context/LanguageContext.tsx.
const LANGUAGE_KEY = 'physics_platform_language';

// Marks a Lesson.video_url as a Backblaze B2 object key rather than a real
// URL — see backend/app/services/b2_storage.py's B2_URL_SCHEME. The B2
// bucket lecture videos live in is PRIVATE (a free B2 account can't make a
// bucket public without adding a payment method), so this can't just be
// turned into a link by string concatenation like the other two cases below
// — it has to be exchanged for a short-lived signed URL from the backend,
// which is why resolveVideoUrl is async now.
const B2_URL_SCHEME = 'b2:';

/**
 * Turns whatever is stored in a Lesson's video_url into something actually
 * playable. Three cases:
 *  - a pasted external link (YouTube, or any other "http(s)://...") passes
 *    through unchanged.
 *  - "b2:<object key>" (a video uploaded from the device, stored in our
 *    private B2 bucket) is exchanged for a fresh signed URL good for a few
 *    hours — see getSignedVideoUrl below. Deliberately not cached anywhere:
 *    a new one is requested every time a lesson screen opens, so it's never
 *    stale.
 *  - anything else is treated as a RELATIVE path (e.g. "/media/videos/..."
 *    from the older local-disk storage, still used when the backend has no
 *    B2 credentials configured) and resolved against the CURRENT API base
 *    URL, not whatever host happened to be active when the video was
 *    uploaded — the dev machine's LAN IP can change (new wifi, router
 *    reboot, etc.).
 */
export async function resolveVideoUrl(videoUrl: string): Promise<string> {
  if (/^https?:\/\//i.test(videoUrl)) return videoUrl;
  if (videoUrl.startsWith(B2_URL_SCHEME)) {
    return getSignedVideoUrl(videoUrl.slice(B2_URL_SCHEME.length));
  }
  return `${getApiBaseUrl()}${videoUrl}`;
}

/** Same resolver as resolveVideoUrl above, under a name that makes sense at
 * a teacher-photo / course-cover-image call site — the b2:/http(s):///media
 * marker convention and the signed-URL exchange are identical for images
 * and video (see backend/app/services/b2_storage.py), so this is a plain
 * alias, not a separate implementation. */
export const resolveFileUrl = resolveVideoUrl;

/** Exchanges a private B2 object key for a short-lived signed playback URL.
 * See backend/app/api/routes/uploads.py's get_video_signed_url. */
async function getSignedVideoUrl(key: string): Promise<string> {
  const { url } = await request<{ url: string }>(`/api/v1/uploads/video-url?key=${encodeURIComponent(key)}`);
  return url;
}

// --- Uploads ------------------------------------------------------------
type UploadPlan =
  | { mode: 'direct'; upload_url: string; content_type: string; file_url: string }
  | { mode: 'proxy' };

/**
 * Uploads a video OR image file picked on-device and returns the URL to
 * store in the relevant field (Lesson.video_url, TeacherProfile.photo_url,
 * Course.cover_image_url — all three share the same b2:/http(s):///media
 * convention, see resolveFileUrl above).
 *
 * Two-step process. First, ask the backend how to upload (POST
 * /upload-url):
 *  - {mode: "direct"} — B2 is configured server-side. Upload the raw file
 *    straight to `upload_url` (a presigned B2 PUT link), never touching our
 *    own backend at all. This is deliberate, not just an optimization: our
 *    backend's home connection has a measured ~0.91 Mbit/s upload speed, so
 *    proxying the file through it on the way to B2 would cross that same
 *    slow uplink twice — once from the admin's device to our backend, once
 *    again from our backend out to B2 — which is exactly the bottleneck
 *    this feature exists to avoid. Going straight to B2 means only the
 *    admin's OWN device's upload speed matters. Applies to small teacher/
 *    cover photos too, not just video — no reason to special-case it.
 *  - {mode: "proxy"} — B2 isn't configured (local dev); video falls back to
 *    the original proxy upload through our own backend at POST /video.
 *    Images have no proxy fallback (this app was always used with B2
 *    configured by the time images were added) — the caller gets a clear
 *    ApiError instead of a silent failure.
 *
 * Deliberately NOT plain fetch() + FormData with a {uri, name, type} part:
 * Expo's newer global fetch implementation throws "Unsupported FormDataPart
 * implementation" for that classic React Native file-part shape. FileSystem
 * (legacy)'s uploadAsync talks to the native networking layer directly and
 * still supports both real multipart file uploads (the proxy fallback) and
 * a raw binary PUT (the direct-to-B2 path).
 */
/** 0..1 fraction of bytes sent so far — real byte counts from the native
 * upload task, not a fake/indeterminate spinner. */
export type UploadProgressCallback = (fraction: number) => void;

async function uploadFile(
  uri: string,
  fileName: string,
  mimeType: string,
  kind: 'video' | 'image',
  onProgress?: UploadProgressCallback,
): Promise<string> {
  const plan = await request<UploadPlan>('/api/v1/uploads/upload-url', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, content_type: mimeType, kind }),
  });

  // createUploadTask (rather than plain uploadAsync) is the only variant of
  // this API that reports byte-level progress as the upload runs — see the
  // callback below. Same underlying native upload either way.
  const reportProgress = (data: FileSystem.FileSystemUploadProgressData) => {
    if (onProgress && data.totalBytesExpectedToSend > 0) {
      onProgress(data.totalBytesSent / data.totalBytesExpectedToSend);
    }
  };

  if (plan.mode === 'direct') {
    // A raw PUT of the file bytes straight to B2's presigned URL — no auth
    // header (the signature embedded in the URL itself is the auth), and no
    // multipart wrapping (B2/S3-style presigned PUT expects the file's raw
    // bytes as the entire request body, matching how the URL was signed).
    const task = FileSystem.createUploadTask(
      plan.upload_url,
      uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': plan.content_type },
      },
      reportProgress,
    );
    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new ApiError(result?.status ?? 0, `Upload to storage failed: HTTP ${result?.status ?? 'unknown'}`);
    }
    return plan.file_url;
  }

  // mode === 'proxy' — B2 isn't configured on this server.
  if (kind === 'image') {
    throw new ApiError(503, 'Image storage is not configured on this server.');
  }
  const token = await getToken();
  const task = FileSystem.createUploadTask(
    `${getApiBaseUrl()}/api/v1/uploads/video`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
    reportProgress,
  );
  const result = await task.uploadAsync();

  if (!result || result.status < 200 || result.status >= 300) {
    let detail = `HTTP ${result?.status ?? 'unknown'}`;
    try {
      const body = JSON.parse(result!.body) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // ignore — non-JSON error body
    }
    throw new ApiError(result?.status ?? 0, detail);
  }

  const { video_url } = JSON.parse(result.body) as { video_url: string };
  return video_url;
}

export function uploadVideo(
  uri: string,
  fileName: string,
  mimeType: string,
  onProgress?: UploadProgressCallback,
): Promise<string> {
  return uploadFile(uri, fileName, mimeType, 'video', onProgress);
}

/** Best-effort cleanup for a file that was already uploaded straight to R2
 * (a "b2:<key>" value) but never actually saved to a lesson/teacher/course
 * — e.g. the admin uploaded a replacement video, then picked ANOTHER one
 * before hitting Save. Silently does nothing (never throws) for an
 * external link — there's nothing in our bucket to remove for one — and
 * for any actual failure, since a failed cleanup should never interrupt
 * whatever the admin is doing next. See app/admin/course/[id].tsx's
 * discardIfUnsaved. */
export async function discardUnsavedUpload(url: string): Promise<void> {
  if (!url.startsWith('b2:')) return;
  try {
    await request<void>(`/api/v1/uploads/object?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
  } catch {
    // best-effort only
  }
}

/** Uploads a teacher photo or chapter cover image — same direct-to-B2 path
 * as uploadVideo, see uploadFile's docstring above. `uri` should already be
 * the final CROPPED image file (see components/ImageCropPicker.tsx), not
 * the raw picker output. */
export function uploadImage(uri: string, fileName: string, mimeType: string): Promise<string> {
  return uploadFile(uri, fileName, mimeType, 'image');
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean; form?: boolean } = {},
): Promise<T> {
  const { auth = true, form = false, headers, ...rest } = options;
  const finalHeaders: Record<string, string> = {
    ...(form ? {} : { 'Content-Type': 'application/json' }),
    ...(headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = await getToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...rest, headers: finalHeaders });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore — non-JSON error body
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// --- Auth -------------------------------------------------------------
// Deliberately does NOT log the student in — the returned account has
// is_verified: false until /verify-email succeeds (see AuthContext.register,
// which stays logged-out after this and lets the caller — RegisterScreen —
// navigate to the verify-email screen next).
export function register(email: string, password: string, fullName?: string) {
  return request<User>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, full_name: fullName }),
    auth: false,
  });
}

export async function login(email: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username: email, password });
  const { access_token } = await request<{ access_token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: body.toString(),
    form: true,
    auth: false,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  await setToken(access_token);
  return getCurrentUser();
}

/** Confirms the 6-digit code emailed at sign-up (or resent below) — success
 * both verifies the account AND logs the student in, same as login() does,
 * so there's no separate "now go log in" step after this. */
export async function verifyEmail(email: string, code: string): Promise<User> {
  const { access_token } = await request<{ access_token: string }>('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
    auth: false,
  });
  await setToken(access_token);
  return getCurrentUser();
}

/** Requests a fresh code — the backend enforces its own cooldown between
 * calls (settings.VERIFICATION_RESEND_COOLDOWN_SECONDS) and surfaces it as a
 * 429 ApiError with a human-readable wait time in the message. */
export function resendVerification(email: string) {
  return request<{ message: string }>('/api/v1/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
    auth: false,
  });
}

export function getCurrentUser() {
  return request<User>('/api/v1/auth/me');
}

export async function logout() {
  await setToken(null);
}

// --- Subjects ---------------------------------------------------------
export function listSubjects() {
  return request<Subject[]>('/api/v1/subjects');
}

export function getSubject(subjectId: string) {
  return request<SubjectDetail>(`/api/v1/subjects/${subjectId}`);
}

export function createSubject(name: string) {
  return request<Subject>('/api/v1/subjects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Admin-only. Also deletes every chapter and lecture inside the subject
 * (the backend cascades this in one transaction) — the caller should
 * confirm with the person before calling this. */
export function deleteSubject(subjectId: string) {
  return request<void>(`/api/v1/subjects/${subjectId}`, { method: 'DELETE' });
}

/** Subjects the current user may add content to (all of them for an admin,
 * just their assignments for an instructor, empty for a student). */
export function myManagedSubjects() {
  return request<Subject[]>('/api/v1/subjects/mine/managed');
}

export function listSubjectInstructors(subjectId: string) {
  return request<Instructor[]>(`/api/v1/subjects/${subjectId}/instructors`);
}

export function assignInstructor(subjectId: string, email: string) {
  return request<Instructor>(`/api/v1/subjects/${subjectId}/instructors`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function unassignInstructor(subjectId: string, userId: string) {
  return request<void>(`/api/v1/subjects/${subjectId}/instructors/${userId}`, {
    method: 'DELETE',
  });
}

// --- Courses & lessons --------------------------------------------------
export function listCourses() {
  return request<Course[]>('/api/v1/courses');
}

export function getCourse(courseId: string) {
  return request<CourseDetail>(`/api/v1/courses/${courseId}`);
}

export function createCourse(input: CourseCreateInput) {
  return request<Course>('/api/v1/courses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCourse(courseId: string, input: CourseUpdateInput) {
  return request<Course>(`/api/v1/courses/${courseId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteCourse(courseId: string) {
  return request<void>(`/api/v1/courses/${courseId}`, { method: 'DELETE' });
}

// --- Teachers (display cards, not real accounts — see lib/types.ts's Teacher) --
export function listTeachers(subjectId: string) {
  return request<Teacher[]>(`/api/v1/subjects/${subjectId}/teachers`);
}

export function createTeacher(input: TeacherCreateInput) {
  return request<Teacher>('/api/v1/teachers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTeacher(teacherId: string, input: TeacherUpdateInput) {
  return request<Teacher>(`/api/v1/teachers/${teacherId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Fails with a 400 ApiError if any chapter still has this teacher
 * assigned — see backend/app/api/routes/teachers.py's delete_teacher. */
export function deleteTeacher(teacherId: string) {
  return request<void>(`/api/v1/teachers/${teacherId}`, { method: 'DELETE' });
}

export function getLesson(lessonId: string) {
  return request<LessonDetail>(`/api/v1/lessons/${lessonId}`);
}

export function createLesson(input: LessonCreateInput) {
  return request<LessonDetail>('/api/v1/lessons', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteLesson(lessonId: string) {
  return request<void>(`/api/v1/lessons/${lessonId}`, { method: 'DELETE' });
}

export function updateLesson(lessonId: string, input: LessonUpdateInput) {
  return request<LessonDetail>(`/api/v1/lessons/${lessonId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// --- Progress -------------------------------------------------------------
export function listProgress() {
  return request<ProgressEntry[]>('/api/v1/progress');
}

export function updateProgress(lessonId: string, completionPercent: number) {
  return request<ProgressEntry>('/api/v1/progress', {
    method: 'PUT',
    body: JSON.stringify({ lesson_id: lessonId, completion_percent: completionPercent }),
  });
}

// --- Segment quiz questions -------------------------------------------------
/** Every question for one lecture, ordered by pause_at_seconds (the "no
 * specific pause point" group sorts last), each carrying the current
 * student's latest attempt if any — see app/lessons/[id].tsx for how these
 * are grouped into per-part quizzes. */
export function getLessonQuestions(lessonId: string) {
  return request<Question[]>(`/api/v1/lessons/${lessonId}/questions`);
}

export function submitQuestionAttempt(questionId: string, submittedAnswer: string) {
  return request<QuestionAttemptResult>(`/api/v1/questions/${questionId}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ submitted_answer: submittedAnswer }),
  });
}

// --- Segment quiz questions: instructor/admin authoring ---------------------
export function getLessonQuestionsAdmin(lessonId: string) {
  return request<QuestionAdmin[]>(`/api/v1/lessons/${lessonId}/questions/admin`);
}

export function createQuestion(input: QuestionCreateInput) {
  return request<QuestionAdmin>('/api/v1/questions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateQuestion(questionId: string, input: QuestionUpdateInput) {
  return request<QuestionAdmin>(`/api/v1/questions/${questionId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteQuestion(questionId: string) {
  return request<void>(`/api/v1/questions/${questionId}`, { method: 'DELETE' });
}

// --- AI Physics Assistant --------------------------------------------------
/** `imageBase64` is raw base64 (no "data:image/...;base64," prefix) of a
 * photo the student attached — see AssistantScreen's image picker. Optional;
 * the backend reads the photo instead of/alongside `question` when present
 * (app/services/ai_service.py). */
export function askPhysicsAssistant(question: string, sessionId?: string, imageBase64?: string) {
  return request<AskResponse>('/api/v1/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ question, session_id: sessionId ?? null, image_base64: imageBase64 ?? null }),
  });
}

export function getChatHistory(sessionId: string) {
  return request<ChatMessage[]>(`/api/v1/ai/sessions/${sessionId}/history`);
}

export function getAiUsage() {
  return request<UsageInfo>('/api/v1/ai/usage');
}

// --- Admin: users & AI limits --------------------------------------------
/** Admin-only. Every registered account, oldest first. */
export function listAllUsers() {
  return request<User[]>('/api/v1/admin/users');
}

/** Admin-only. `dailyLimit: null` clears the override and reverts this
 * account to its plan's default AI question limit. Has no effect on an
 * admin-role account — those are always unlimited (see User.effective_ai_daily_limit). */
export function setUserAiLimit(userId: string, dailyLimit: number | null) {
  return request<User>(`/api/v1/admin/users/${userId}/ai-limit`, {
    method: 'PUT',
    body: JSON.stringify({ daily_limit: dailyLimit }),
  });
}

/** Admin-only. Grants `extra` more questions for TODAY only — e.g. a
 * student ran out and asked for a few more — without touching their
 * permanent daily limit. Stacks with any bonus already granted today. */
export function grantAiBonusQuestions(userId: string, extra: number) {
  return request<User>(`/api/v1/admin/users/${userId}/ai-bonus`, {
    method: 'POST',
    body: JSON.stringify({ extra }),
  });
}

// --- Per-lecture view limits (admin) -------------------------------------
// See app/lessons/[id].tsx (student-side enforcement) and
// app/admin/video-views.tsx (this admin screen) for the full feature.

export function listUserLessonViews(userId: string) {
  return request<LessonViewInfo[]>(`/api/v1/admin/users/${userId}/lesson-views`);
}

export function grantBonusViews(userId: string, lessonId: string, extra: number) {
  return request<LessonViewInfo>(`/api/v1/admin/users/${userId}/lessons/${lessonId}/bonus-views`, {
    method: 'POST',
    body: JSON.stringify({ extra }),
  });
}

export function resetLessonViews(userId: string, lessonId: string) {
  return request<LessonViewInfo>(`/api/v1/admin/users/${userId}/lessons/${lessonId}/reset-views`, {
    method: 'POST',
  });
}

// --- Per-lecture redemption codes -----------------------------------------
// See lib/types.ts's LessonAccessCode/RedeemCodeResult and
// backend/app/api/routes/lesson_access_codes.py.

/** Instructor/admin. Every code generated for this lecture so far, oldest
 * first — used and unused together (see LessonAccessCode.redeemed). */
export function listLessonCodes(lessonId: string) {
  return request<LessonAccessCode[]>(`/api/v1/lessons/${lessonId}/codes`);
}

/** Instructor/admin. Generates `count` brand-new single-use codes for this
 * lecture — the first call for a lecture is what switches it from "open to
 * any student" into "requires a code" going forward. */
export function generateLessonCodes(lessonId: string, count: number) {
  return request<LessonAccessCode[]>(`/api/v1/lessons/${lessonId}/codes`, {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

/** Instructor/admin. Only works on a code nobody has redeemed yet — the
 * backend rejects removing one that's already unlocked a student's video. */
export function deleteLessonCode(lessonId: string, codeId: string) {
  return request<void>(`/api/v1/lessons/${lessonId}/codes/${codeId}`, { method: 'DELETE' });
}

/** Student. Redeems one code, unlocking whichever lecture it belongs to for
 * the signed-in student — see app/(tabs)/courses/[subjectId]/[courseId].tsx.
 * Throws an ApiError (404 invalid code, 409 already used by someone else)
 * the caller shows inline; redeeming a code you already redeemed yourself
 * succeeds again rather than erroring. */
export function redeemLessonCode(code: string) {
  return request<RedeemCodeResult>('/api/v1/lessons/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

// --- Standalone exams -------------------------------------------------------
// See lib/types.ts's Exam* types and backend/app/api/routes/exams.py.

/** Instructor/admin. Every standalone exam in this chapter, ordered by
 * order_index. */
export function listCourseExams(courseId: string) {
  return request<ExamAdmin[]>(`/api/v1/exams/course/${courseId}`);
}

/** Instructor/admin. Single-exam fetch by id — for the exam-questions
 * management screen (app/admin/exam/[id].tsx), which only has the exam's
 * own id in its route params. */
export function getExam(examId: string) {
  return request<ExamAdmin>(`/api/v1/exams/${examId}`);
}

export function createExam(input: ExamCreateInput) {
  return request<ExamAdmin>('/api/v1/exams', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateExam(examId: string, input: ExamUpdateInput) {
  return request<ExamAdmin>(`/api/v1/exams/${examId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteExam(examId: string) {
  return request<void>(`/api/v1/exams/${examId}`, { method: 'DELETE' });
}

/** Instructor/admin — same shape as getLessonQuestionsAdmin but for an
 * exam's questions. */
export function getExamQuestionsAdmin(examId: string) {
  return request<QuestionAdmin[]>(`/api/v1/exams/${examId}/questions/admin`);
}

/** Student. Whether this student has already passed the exam, and whether
 * there's an in-progress attempt to resume — check this before showing a
 * "start exam" button so a returning student sees a result/resume screen
 * instead. */
export function getExamStatus(examId: string) {
  return request<ExamStatus>(`/api/v1/exams/${examId}/status`);
}

/** Student. Starts a fresh attempt, or resumes one already in progress (see
 * ExamStatus.in_progress_attempt_id) — either way, `started_at` is the
 * server clock the app's timer must be built from. */
export function startExam(examId: string) {
  return request<ExamStartResult>(`/api/v1/exams/${examId}/start`, { method: 'POST' });
}

/** Student. Submits every answer at once and gets back the graded result —
 * see ExamSubmitResult. Throws a 409 ApiError if this attempt was already
 * submitted (e.g. a double-tap). */
export function submitExam(attemptId: string, answers: ExamAnswerSubmit[]) {
  return request<ExamSubmitResult>(`/api/v1/exams/attempts/${attemptId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

// --- Security notifications ----------------------------------------------
/** Fires (best-effort, errors swallowed) whenever the hidden server-settings
 * screen is reached or an access code is tried — see app/server-settings.tsx.
 * No auth (that screen is reachable while logged out on purpose), and never
 * throws so a slow or unreachable backend can't get in the way of that
 * screen's own UI or block a genuine attempt to use it while testing. */
export async function reportServerSettingsAttempt(
  event: 'opened' | 'unlock_success' | 'unlock_failed',
): Promise<void> {
  try {
    await request<void>('/api/v1/security/server-settings-attempt', {
      method: 'POST',
      body: JSON.stringify({ event }),
      auth: false,
    });
  } catch {
    // best-effort only — a failed notification should never block this screen
  }
}

export async function getSavedAssistantSessionId(): Promise<string | null> {
  return SecureStore.getItemAsync(ASSISTANT_SESSION_KEY);
}

export async function setSavedAssistantSessionId(sessionId: string | null): Promise<void> {
  if (sessionId) {
    await SecureStore.setItemAsync(ASSISTANT_SESSION_KEY, sessionId);
  } else {
    await SecureStore.deleteItemAsync(ASSISTANT_SESSION_KEY);
  }
}

export async function getSavedLanguage(): Promise<'ar' | 'en' | null> {
  const v = await SecureStore.getItemAsync(LANGUAGE_KEY);
  return v === 'ar' || v === 'en' ? v : null;
}

export async function setSavedLanguage(language: 'ar' | 'en'): Promise<void> {
  await SecureStore.setItemAsync(LANGUAGE_KEY, language);
}
