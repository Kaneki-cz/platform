export type UserRole = 'student' | 'instructor' | 'admin';

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  plan: 'free' | 'pro';
  role: UserRole;
  // False until the sign-up email-verification code is confirmed (see
  // app/(auth)/verify-email.tsx and backend app/api/routes/auth.py) — always
  // true for accounts that existed before this feature shipped.
  is_verified: boolean;
  // Admin-only fields (present on every UserOut the backend returns, but
  // only really relevant on the admin "AI Question Limits" screen).
  // null override => this account just uses its plan's default limit.
  ai_daily_limit_override: number | null;
  // null = unlimited — always true for role: 'admin' accounts, which are
  // never rate-limited regardless of any override.
  effective_ai_daily_limit: number | null;
  // Extra questions granted for TODAY only (on top of the above) — see
  // setUserAiLimit vs grantAiBonusQuestions in lib/api.ts.
  ai_bonus_questions_today: number;
}

export interface Subject {
  id: string;
  name: string;
  order_index: number;
}

export interface SubjectDetail extends Subject {
  courses: Course[];
}

// The fixed, final set of grade levels a chapter can be filed under —
// MUST match backend/app/schemas/course.py's GradeLevel Literal exactly
// (confirmed with the user as exactly these 4 Arabic strings, no others).
export const GRADE_LEVELS = [
  'الصف الأول الثانوي',
  'الصف الثاني الثانوي - بكالوريا',
  'الصف الثاني الثانوي - عام',
  'الصف الثالث الثانوي - عام',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

// A display-card teacher within a subject — admin-managed, no login of its
// own. NOT the same thing as Instructor below (a real user account with
// edit permissions) — see backend/app/models/teacher.py for the full
// distinction.
export interface Teacher {
  id: string;
  subject_id: string;
  name: string;
  photo_url: string | null;
  order_index: number;
}

export interface TeacherCreateInput {
  subject_id: string;
  name: string;
  photo_url?: string;
  order_index?: number;
}

export interface TeacherUpdateInput {
  name?: string;
  photo_url?: string;
  order_index?: number;
}

export interface Course {
  id: string;
  subject_id: string;
  title: string;
  description: string | null;
  grade_level: GradeLevel | null;
  teacher_id: string | null;
  cover_image_url: string | null;
  order_index: number;
}

export interface Lesson {
  id: string;
  title: string;
  video_url: string | null;
  // Same b2:<key> / http(s):// / /media/... convention as Course.cover_image_url
  // — lets the chapter screen render lectures as poster cards, same visual
  // treatment as chapters get on the subject screen. null = show a
  // placeholder tile (the common case for a lecture with no cover set).
  cover_image_url: string | null;
  order_index: number;
  // True when this lecture has no segment quizzes, or the signed-in student
  // has passed every one of them — computed server-side per-request (see
  // GET /api/v1/courses/{id} in the backend). Locks the NEXT lecture in the
  // chapter list until this one's segment quizzes are cleared; see
  // app/(tabs)/courses/[subjectId]/index.tsx and app/lessons/[id].tsx.
  quiz_passed: boolean;
  // How many times ONE student account may open this lecture's video — null
  // (the default) means unlimited. Set per-lecture from the admin "Lectures"
  // screen; enforced server-side in GET /api/v1/lessons/{id}. See
  // app/admin/video-views.tsx for how an admin fixes up a student who hit
  // this by mistake (e.g. an accidental reload).
  max_views: number | null;
  // True once an instructor/admin has generated at least one redemption
  // code for this lecture (see lib/api.ts's generateLessonCodes) — false for
  // every lecture that never opted into this, same as max_views being null.
  // Independent of quiz_passed/max_views: a lecture can be code-gated with
  // or without also having a view limit. Only ever meaningful for a
  // signed-in STUDENT (always false for instructors/admins, who are never
  // gated — see backend/app/api/routes/courses.py's _annotate_code_gate).
  requires_code: boolean;
  // Meaningless when requires_code is false. True once the signed-in
  // student has redeemed ANY code for this specific lecture — see
  // app/(tabs)/courses/[subjectId]/[courseId].tsx for the "enter a code"
  // prompt shown while this is false.
  code_unlocked: boolean;
  // True once the signed-in student is blocked from this lecture by one or
  // more unpassed standalone Exams earlier in the same chapter (see the
  // `exams` array on CourseDetail below) — always false for
  // instructors/admins, and for any lecture with exempt_from_exam_gate set.
  // video_url is already null server-side whenever this is true.
  locked_by_exam: boolean;
  // Admin-only escape hatch: this lecture stays reachable even though an
  // earlier standalone exam in the chapter hasn't been passed yet. Shown
  // as a toggle on the admin lecture-edit form.
  exempt_from_exam_gate: boolean;
}

export interface LessonDetail extends Lesson {
  content: string | null;
  // The next three are only ever meaningful for a signed-in STUDENT on a
  // max_views-capped lesson (null/false otherwise — instructors/admins are
  // never capped, and uncapped lessons don't track this at all). See
  // app/lessons/[id].tsx: when view_limit_reached is true, video_url above
  // is already null (the backend won't hand it back), so the screen shows a
  // locked message instead of trying to render a player.
  views_used: number | null;
  views_allowed: number | null;
  view_limit_reached: boolean;
}

// One student's view-count standing on one max_views-capped lesson — see
// GET /api/v1/admin/users/{id}/lesson-views and app/admin/video-views.tsx.
export interface LessonViewInfo {
  lesson_id: string;
  lesson_title: string;
  course_title: string;
  max_views: number;
  view_count: number;
  bonus_views: number;
  views_allowed: number;
  view_limit_reached: boolean;
}

export interface CourseDetail extends Course {
  lessons: Lesson[];
  // Empty for the common case (a chapter with no standalone exams) — see
  // app/(tabs)/courses/[subjectId]/[courseId].tsx, which renders these
  // interleaved with `lessons` by order_index.
  exams: ExamSummary[];
}

// --- Per-lecture redemption codes (admin-generated, student-redeemed) -----
// See backend/app/models/lesson_access_code.py. A code unlocks ONE specific
// lecture for whichever student redeems it, is single-use, and is unique
// across the WHOLE platform (never just within one lecture) — see
// app/admin/course/[id].tsx (generate/manage) and
// app/(tabs)/courses/[subjectId]/[courseId].tsx (student redeem prompt).
export interface LessonAccessCode {
  id: string;
  code: string;
  redeemed: boolean;
  redeemed_at: string | null;
  created_at: string;
}

export interface RedeemCodeResult {
  lesson_id: string;
  course_id: string;
  lesson_title: string;
}

export interface ProgressEntry {
  lesson_id: string;
  completion_percent: number;
}

export interface VisualizationPayload {
  type: 'motion_diagram' | 'graph' | 'free_body_diagram' | 'circuit' | 'wave' | 'vector_field' | string;
  data: Record<string, unknown>;
}

export interface AskResponse {
  session_id: string;
  answer: string;
  steps: string[];
  visualization: VisualizationPayload | null;
  // null = unlimited (always true for admin accounts). daily_limit is the
  // TOTAL available today — base limit plus any bonus_questions_today.
  remaining_today: number | null;
  daily_limit: number | null;
  bonus_questions_today: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  visualization: VisualizationPayload | null;
  created_at: string;
}

/** Today's AI-question quota — see GET /api/v1/ai/usage and the
 * remaining_today/daily_limit fields on AskResponse. null = unlimited. */
export interface UsageInfo {
  used_today: number;
  daily_limit: number | null;
  remaining_today: number | null;
  bonus_questions_today: number;
}

// --- Instructor / admin content-management -------------------------------
export interface CourseCreateInput {
  subject_id: string;
  title: string;
  description?: string;
  grade_level?: GradeLevel;
  teacher_id?: string;
  cover_image_url?: string;
  order_index?: number;
}

export interface CourseUpdateInput {
  title?: string;
  description?: string;
  grade_level?: GradeLevel;
  teacher_id?: string | null;
  cover_image_url?: string;
  order_index?: number;
}

export interface LessonCreateInput {
  course_id: string;
  title: string;
  content?: string;
  video_url?: string;
  cover_image_url?: string | null;
  order_index?: number;
  max_views?: number | null;
  exempt_from_exam_gate?: boolean;
}

export interface LessonUpdateInput {
  title?: string;
  content?: string;
  video_url?: string;
  // Explicitly pass null (not undefined) to clear a lecture's cover image —
  // same "explicit null is a real update, omitted is not" convention as
  // Question.image_url (see backend/app/api/routes/questions.py).
  cover_image_url?: string | null;
  order_index?: number;
  // Explicitly pass null (not undefined) to clear a lecture's view cap back
  // to unlimited — see PUT /api/v1/lessons/{id}, which only applies fields
  // actually present in the request body.
  max_views?: number | null;
  exempt_from_exam_gate?: boolean;
}

export interface Instructor {
  user_id: string;
  email: string;
  full_name: string | null;
}

// --- Segment quiz questions ------------------------------------------------
// A lecture's video can be split into "parts" — every Question sharing the
// same pause_at_seconds belongs to the same part's quiz, shown when
// playback reaches that timestamp (null = shown once the video ends
// instead). See app/lessons/[id].tsx and app/components/LessonVideoPlayer.tsx.
export type QuestionType = 'multiple_choice' | 'numeric' | 'free_response' | string;

export interface QuestionAttemptState {
  is_correct: boolean;
}

export interface Question {
  id: string;
  // Belongs to EXACTLY ONE of lesson_id (an in-video segment quiz
  // question) or exam_id (a standalone-exam question — see the Exam types
  // below). Both optional for that reason.
  lesson_id?: string | null;
  exam_id?: string | null;
  prompt: string;
  question_type: QuestionType;
  // multiple_choice: {"A": "...", "B": "..."} — see QuestionAdmin's own
  // authoring form for how these are entered.
  choices: Record<string, string> | null;
  pause_at_seconds: number | null;
  // An optional diagram/photo of the physics problem, rendered above the
  // prompt via <ResolvedImage> — same b2:/http/relative resolution as a
  // teacher photo or chapter cover. Null for a question with no image.
  image_url: string | null;
  // This student's most recent attempt at this question, if any — lets the
  // app resume a partially-answered segment without a second round-trip.
  your_attempt: QuestionAttemptState | null;
}

export interface QuestionAttemptResult {
  is_correct: boolean;
  correct_answer: string;
  explanation: string | null;
}

// Instructor/admin authoring — includes the answer key, unlike Question.
export interface QuestionAdmin {
  id: string;
  lesson_id?: string | null;
  exam_id?: string | null;
  prompt: string;
  question_type: QuestionType;
  choices: Record<string, string> | null;
  correct_answer: string;
  explanation: string | null;
  pause_at_seconds: number | null;
  image_url: string | null;
}

export interface QuestionCreateInput {
  // Set exactly one of lesson_id/exam_id.
  lesson_id?: string;
  exam_id?: string;
  prompt: string;
  question_type?: QuestionType;
  choices?: Record<string, string> | null;
  correct_answer: string;
  explanation?: string;
  pause_at_seconds?: number | null;
  image_url?: string | null;
}

export interface QuestionUpdateInput {
  prompt?: string;
  question_type?: QuestionType;
  choices?: Record<string, string> | null;
  correct_answer?: string;
  explanation?: string;
  pause_at_seconds?: number | null;
  image_url?: string | null;
}

// --- Standalone exams -------------------------------------------------------
// A full exam attached to a chapter — separate from the in-video segment
// quizzes above. Sits at a specific point in the chapter's lecture order
// (order_index, sharing Lesson.order_index's numbering space) and gates
// every lecture after it until the student passes it (score >=
// passing_percent) — see backend/app/services/exam_gate.py. See
// app/(tabs)/courses/[subjectId]/[courseId].tsx (student: card + take/result
// screen) and app/admin/course/[id].tsx (admin: create/edit + questions).

// The chapter/lecture LIST view's summary of one exam — enough to render an
// exam "card" interleaved with lessons and a start/result button.
export interface ExamSummary {
  id: string;
  title: string;
  order_index: number;
  passing_percent: number;
  question_count: number;
  // Only ever meaningful for a signed-in STUDENT — null for
  // instructors/admins and for a student who hasn't passed it yet.
  passed: boolean | null;
  best_score_percent: number | null;
}

// Instructor/admin management view of one exam.
export interface ExamAdmin {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  passing_percent: number;
  question_count: number;
}

export interface ExamCreateInput {
  course_id: string;
  title: string;
  description?: string;
  order_index?: number;
  passing_percent?: number;
}

export interface ExamUpdateInput {
  title?: string;
  description?: string;
  order_index?: number;
  passing_percent?: number;
}

// What a student sees before deciding to start/resume an exam.
export interface ExamStatus {
  passed: boolean;
  best_score_percent: number | null;
  // Set when a previous sitting was started but never submitted — the app
  // resumes it (same attempt_id, same server-anchored started_at) instead
  // of starting a fresh one, so the timer can't be "reset" by force-closing
  // the app.
  in_progress_attempt_id: string | null;
  in_progress_started_at: string | null;
}

// What a student sees while taking the exam — no correct_answer, no
// explanation (revealed only after submitting, in ExamAnswerResult below).
export interface ExamQuestionForStudent {
  id: string;
  prompt: string;
  question_type: QuestionType;
  choices: Record<string, string> | null;
  image_url: string | null;
}

export interface ExamStartResult {
  attempt_id: string;
  // Server-anchored — the app's timer counts up from this, never from its
  // own clock.
  started_at: string;
  passing_percent: number;
  questions: ExamQuestionForStudent[];
}

export interface ExamAnswerSubmit {
  question_id: string;
  submitted_answer: string;
}

export interface ExamAnswerResult {
  question_id: string;
  is_correct: boolean;
  correct_answer: string;
  explanation: string | null;
}

export interface ExamSubmitResult {
  score_percent: number;
  passed: boolean;
  correct_count: number;
  total_count: number;
  duration_seconds: number;
  answers: ExamAnswerResult[];
}
