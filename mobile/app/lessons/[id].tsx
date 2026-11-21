import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';

import {
  getEnrollmentStatus,
  getLesson,
  getLessonQuestions,
  reportVideoSkip,
  resolveVideoUrl,
  submitQuestionAttempt,
  updateProgress,
} from '@/lib/api';
import { EnrollmentModal } from '@/components/EnrollmentModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LessonVideoPlayer, type LessonVideoPlayerHandle } from '@/components/LessonVideoPlayer';
import { Skeleton } from '@/components/motion';
import { SegmentQuiz } from '@/components/SegmentQuiz';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { EnrollmentStatus, LessonDetail, Question } from '@/lib/types';

// Don't bother persisting the first few seconds of playback — avoids a
// flood of near-zero progress writes the instant the video starts.
const MIN_REPORTABLE_PERCENT = 5;
// Only push a new progress update once watch position has advanced by at
// least this many points since the last one we sent (100 always goes
// through, so finishing early never gets missed).
const PROGRESS_STEP = 10;
const PASS_THRESHOLD = 0.75;
// Same "finished" line the backend uses for completed lessons.
const DONE_PERCENT = 90;

// This screen is student-facing, so its UI text follows the app-wide
// Arabic/English toggle (see context/LanguageContext.tsx) — unlike the
// admin screens, which stay English on purpose.
type LessonStrings = {
  limitReached: string;
  viewsLabel: (used: number, allowed: number) => string;
  contactHint: string;
  loadFailed: string;
  videoFailed: string;
  retry: string;
  checkpoints: (passed: number, total: number) => string;
  lessonDone: string;
};

const STRINGS: Record<'ar' | 'en', LessonStrings> = {
  ar: {
    limitReached: 'لقد استنفذت عدد المشاهدات المسموح بها لهذا الفيديو',
    viewsLabel: (used, allowed) => `المشاهدات: ${used}/${allowed}`,
    contactHint: 'تواصل مع المدرس أو الأدمن لو محتاج مشاهدات إضافية.',
    loadFailed: 'مقدرناش نحمّل المحاضرة. اتأكد من النت وجرّب تاني.',
    videoFailed: 'الفيديو مااشتغلش. اتأكد من النت وجرّب تاني.',
    retry: 'جرّب تاني',
    checkpoints: (passed, total) => `نقط الأسئلة: عدّيت ${passed} من ${total}`,
    lessonDone: 'خلّصت الدرس ده!',
  },
  en: {
    limitReached: "You've used up all the allowed views for this video",
    viewsLabel: (used, allowed) => `Views: ${used}/${allowed}`,
    contactHint: 'Contact your teacher or an admin if you need extra views.',
    loadFailed: "Couldn't load this lecture. Check your connection and try again.",
    videoFailed: "The video didn't load. Check your connection and try again.",
    retry: 'Try again',
    checkpoints: (passed, total) => `Checkpoints: ${passed} of ${total} passed`,
    lessonDone: 'Lesson complete!',
  },
};

interface Segment {
  // null only for the trailing "no specific pause point" group before the
  // video's real duration is known — resolved to a real second value below.
  pauseAtSeconds: number | null;
  startSeconds: number;
  questions: Question[];
}

/** Groups questions (already ordered by the backend: numeric
 * pause_at_seconds ascending, then the "no pause point" group last) into
 * per-part segments, and resolves that trailing group's boundary to the
 * video's real duration once known. */
function buildSegments(questions: Question[], duration: number | null): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const q of questions) {
    const last = segments[segments.length - 1];
    if (last && last.pauseAtSeconds === q.pause_at_seconds) {
      last.questions.push(q);
      continue;
    }
    if (last && last.pauseAtSeconds != null) start = last.pauseAtSeconds;
    segments.push({ pauseAtSeconds: q.pause_at_seconds, startSeconds: start, questions: [q] });
  }
  if (duration != null) {
    for (const seg of segments) {
      if (seg.pauseAtSeconds == null) seg.pauseAtSeconds = Math.floor(duration);
    }
  }
  return segments;
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  // resolveVideoUrl is async now (a B2-hosted video needs a network call to
  // exchange its stored object key for a short-lived signed URL — see
  // lib/api.ts) — resolved into this once lesson.video_url is known, rather
  // than inline in JSX. null while resolving/no video, so the player only
  // mounts once there's an actual URL to give it.
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  // questionId -> is_correct, from attempts submitted THIS visit — merged
  // over each question's own your_attempt (from the initial fetch) so a
  // retry updates the pass/fail calculation immediately without refetching.
  const [attemptOverrides, setAttemptOverrides] = useState<Record<string, boolean>>({});
  const [duration, setDuration] = useState<number | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<Segment | null>(null);
  // Enrollment — only relevant for students. null = not yet checked (or no
  // teacher on this lesson); checked after lesson data loads.
  const [enrollmentStatus, setEnrollmentStatus] = useState<EnrollmentStatus | null>(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const lastSentPercent = useRef(0);
  const videoRef = useRef<LessonVideoPlayerHandle>(null);
  // Diagnostic only (see the blank-screen-on-opening-a-lesson report) — was
  // previously "if (!lesson) return null", which left NOTHING on screen
  // while getLesson was in flight (or if it silently failed), making a slow
  // request indistinguishable from a genuine crash. Now shows *something*
  // either way, so a report can say which one it actually is.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by the retry buttons to re-run the matching fetch below.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [videoAttempt, setVideoAttempt] = useState(0);
  const [videoError, setVideoError] = useState(false);
  // Brief "Lesson complete" badge the moment watching crosses the done line.
  const [justCompleted, setJustCompleted] = useState(false);

  // useFocusEffect (not useEffect) so re-opening a lesson (e.g. after an
  // instructor edits it) picks up fresh content without a full app reload.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      lastSentPercent.current = 0;
      setAttemptOverrides({});
      setDuration(null);
      setActiveQuiz(null);
      setResolvedVideoUrl(null);
      setEnrollmentStatus(null);
      setShowEnrollment(false);
      setLoadError(null);
      setVideoError(false);
      getLesson(id)
        .then((l) => {
          setLesson(l);
          if (!l.video_url) {
            // No video to track playback of — opening the lecture's text
            // content is the only signal available, so treat it as done.
            updateProgress(id, 100).catch(() => {});
          }
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error('getLesson failed:', e);
          setLoadError(e instanceof Error ? e.message : String(e));
        });
      getLessonQuestions(id)
        .then(setQuestions)
        .catch(() => {});
    }, [id, loadAttempt]),
  );

  // Check enrollment once lesson data is loaded — students only, and only
  // when the lesson belongs to a teacher. Shows EnrollmentModal if the
  // student hasn't enrolled yet OR if groups were added since they enrolled.
  useEffect(() => {
    if (!lesson?.teacher_id) return;
    if (user?.role !== 'student') return;
    getEnrollmentStatus(lesson.teacher_id)
      .then((s) => {
        setEnrollmentStatus(s);
        if (!s.enrolled || s.needs_group) setShowEnrollment(true);
      })
      .catch(() => {
        // Network error — don't block the lesson; let them watch anyway.
      });
  }, [lesson?.teacher_id, user?.role]);

  // Resolves lesson.video_url (a raw stored value — an external link, a
  // "b2:<key>" marker, or a legacy relative /media/ path) into an actual
  // playable URL. Runs whenever the lesson's video_url changes; a stale
  // in-flight resolution from a previous lesson is discarded via the
  // `cancelled` flag if the user navigates away/to another lesson before it
  // finishes.
  useEffect(() => {
    if (!lesson?.video_url) return undefined;
    let cancelled = false;
    setVideoError(false);
    resolveVideoUrl(lesson.video_url, id)
      .then((url) => {
        if (!cancelled) setResolvedVideoUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedVideoUrl(null);
          setVideoError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lesson?.video_url, videoAttempt]);

  const segments = useMemo(() => buildSegments(questions, duration), [questions, duration]);

  const isCorrect = useCallback(
    (q: Question) => attemptOverrides[q.id] ?? q.your_attempt?.is_correct ?? false,
    [attemptOverrides],
  );
  const segmentPassed = useCallback(
    (seg: Segment) => seg.questions.filter(isCorrect).length / seg.questions.length >= PASS_THRESHOLD,
    [isCorrect],
  );

  const activeSegmentIndex = segments.findIndex((seg) => !segmentPassed(seg));
  const passedSegments = segments.filter(segmentPassed).length;
  const nextPauseAtSeconds = activeSegmentIndex >= 0 ? segments[activeSegmentIndex].pauseAtSeconds : null;

  // Video lectures report real watch percentage instead — see
  // LessonVideoPlayer's onProgress (backed by expo-video's timeUpdate).
  const onVideoProgress = useCallback(
    (percent: number) => {
      if (!id) return;
      if (percent < MIN_REPORTABLE_PERCENT) return;
      // Never re-send a value we've already reported (including 100 itself)
      // — without this, once a video finishes, every subsequent tick from
      // the player (expo-video's timeUpdate keeps firing at the end of
      // playback until the screen closes) recomputes percent as 100 again,
      // and the "< 100" half of the throttle below stops applying, so it'd
      // PUT /progress once a second forever instead of exactly once.
      if (percent <= lastSentPercent.current) return;
      if (percent < 100 && percent < lastSentPercent.current + PROGRESS_STEP) return;
      if (lastSentPercent.current < DONE_PERCENT && percent >= DONE_PERCENT) {
        setJustCompleted(true);
        setTimeout(() => setJustCompleted(false), 3200);
      }
      lastSentPercent.current = percent;
      updateProgress(id, percent).catch(() => {});
    },
    [id],
  );

  // Best-effort cheat-detection nudge for the Teacher Dashboard — see
  // LessonVideoPlayer's onSkip. Only meaningful for students (an
  // instructor/admin previewing their own lecture isn't "cheating"), and
  // never blocks or slows down playback either way.
  const onVideoSkip = useCallback(
    (skippedSeconds: number) => {
      if (!id) return;
      if (user?.role !== 'student') return;
      reportVideoSkip(id, skippedSeconds).catch(() => {});
    },
    [id, user?.role],
  );

  const onSubmitAnswer = useCallback(async (questionId: string, answer: string) => {
    const result = await submitQuestionAttempt(questionId, answer);
    setAttemptOverrides((prev) => ({ ...prev, [questionId]: result.is_correct }));
    return result;
  }, []);

  const onReachBoundary = useCallback(() => {
    if (activeSegmentIndex >= 0) setActiveQuiz(segments[activeSegmentIndex]);
  }, [activeSegmentIndex, segments]);

  const onFinishQuiz = useCallback(
    (passed: boolean) => {
      const seg = activeQuiz;
      setActiveQuiz(null);
      if (!seg) return;
      if (!passed) {
        videoRef.current?.seekTo(seg.startSeconds);
      }
      videoRef.current?.play();
    },
    [activeQuiz],
  );

  if (!lesson) {
    if (loadError) {
      return (
        <View style={[styles.container, styles.centerFill]}>
          <RetryNotice message={t.loadFailed} retryLabel={t.retry} onRetry={() => setLoadAttempt((n) => n + 1)} />
        </View>
      );
    }
    return (
      <View style={[styles.container, { padding: 20 }]}>
        <Skeleton style={{ height: 26, width: '70%', marginBottom: spacing.lg }} />
        <Skeleton style={styles.playerSkeleton} />
        <Skeleton style={{ height: 14, width: '90%', marginTop: spacing.lg }} />
        <Skeleton style={{ height: 14, width: '75%', marginTop: spacing.sm }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <Animated.Text entering={FadeInDown.duration(350)} style={styles.title}>
          {lesson.title}
        </Animated.Text>

        {segments.length > 0 && !lesson.view_limit_reached ? (
          <Animated.View entering={FadeIn.delay(150)} style={styles.checkpoints}>
            <View style={styles.checkpointsHeader}>
              <Ionicons name="flag-outline" size={14} color={colors.primary} />
              <Text style={styles.checkpointsText}>{t.checkpoints(passedSegments, segments.length)}</Text>
            </View>
            <View style={styles.checkpointsTrack}>
              {segments.map((seg, i) => (
                <View
                  key={i}
                  style={[
                    styles.checkpointPip,
                    segmentPassed(seg) ? styles.checkpointPassed : i === activeSegmentIndex ? styles.checkpointActive : null,
                  ]}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}

        {lesson.view_limit_reached ? (
          // video_url is already null in this case — the backend won't hand
          // it back once the limit's hit (see GET /api/v1/lessons/{id}) —
          // so there's nothing to resolve/play. Show why instead of leaving
          // a blank space where the video would be.
          <View style={styles.lockedBox}>
            <Text style={styles.lockedTitle}>{t.limitReached}</Text>
            {lesson.views_allowed != null ? (
              <Text style={styles.lockedMeta}>{t.viewsLabel(lesson.views_used ?? 0, lesson.views_allowed)}</Text>
            ) : null}
            <Text style={styles.lockedHint}>{t.contactHint}</Text>
          </View>
        ) : resolvedVideoUrl ? (
          <ErrorBoundary label="Video player crashed">
            <LessonVideoPlayer
              ref={videoRef}
              url={resolvedVideoUrl}
              onProgress={onVideoProgress}
              onDurationKnown={setDuration}
              pauseAtSeconds={nextPauseAtSeconds}
              onReachBoundary={onReachBoundary}
              onSkip={onVideoSkip}
            />
            {lesson.views_allowed != null ? (
              <Text style={styles.viewsMeta}>{t.viewsLabel(lesson.views_used ?? 0, lesson.views_allowed)}</Text>
            ) : null}
          </ErrorBoundary>
        ) : lesson.video_url ? (
          videoError ? (
            <View style={styles.playerError}>
              <RetryNotice message={t.videoFailed} retryLabel={t.retry} onRetry={() => setVideoAttempt((n) => n + 1)} />
            </View>
          ) : (
            <Skeleton style={styles.playerSkeleton} />
          )
        ) : null}

        {lesson.content ? <Text style={styles.content}>{lesson.content}</Text> : null}
      </ScrollView>

      {justCompleted ? (
        <Animated.View
          entering={ZoomIn.springify().damping(12)}
          exiting={FadeOut.duration(300)}
          style={styles.doneBadge}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.doneText}>{t.lessonDone}</Text>
        </Animated.View>
      ) : null}

      {activeQuiz ? (
        <SegmentQuiz
          language={language}
          questions={activeQuiz.questions}
          onSubmitAnswer={onSubmitAnswer}
          onFinish={onFinishQuiz}
        />
      ) : null}

      {showEnrollment && enrollmentStatus && lesson?.teacher_id ? (
        <EnrollmentModal
          teacherId={lesson.teacher_id}
          status={enrollmentStatus}
          language={language}
          onDone={(updated) => {
            setEnrollmentStatus(updated);
            // Keep showing if group still needed (e.g. validation edge case)
            setShowEnrollment(updated.needs_group);
          }}
        />
      ) : null}
    </View>
  );
}

function RetryNotice({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <View style={styles.retryBox}>
      <Ionicons name="cloud-offline-outline" size={30} color={colors.textMuted} />
      <Text style={styles.retryMessage}>{message}</Text>
      <Pressable style={styles.retryButton} onPress={onRetry} hitSlop={6} accessibilityRole="button">
        <Ionicons name="refresh" size={15} color={colors.primary} />
        <Text style={styles.retryButtonText}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerFill: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  title: { fontSize: 22, fontFamily: fonts.bold, marginBottom: spacing.md, color: colors.text },
  content: { fontSize: 16, lineHeight: 26, color: colors.text, fontFamily: fonts.regular, marginTop: spacing.lg },
  // Matches LessonVideoPlayer's own fixed 220pt height so nothing jumps
  // when the real player replaces the placeholder.
  playerSkeleton: { height: 220, borderRadius: radius.lg },
  playerError: {
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBox: { alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  retryMessage: { color: colors.textMuted, fontSize: 14, textAlign: 'center', fontFamily: fonts.regular, lineHeight: 21 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: `${colors.primary}59`,
    minHeight: 44,
  },
  retryButtonText: { color: colors.primary, fontFamily: fonts.semiBold, fontSize: 14 },
  checkpoints: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  checkpointsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkpointsText: { color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.medium },
  checkpointsTrack: { flexDirection: 'row', gap: 4 },
  checkpointPip: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt },
  checkpointPassed: { backgroundColor: colors.success },
  checkpointActive: { backgroundColor: colors.primary },
  doneBadge: {
    position: 'absolute',
    top: spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: `${colors.success}66`,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  doneText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  viewsMeta: { fontSize: 12, color: colors.textFaint, marginTop: 6, textAlign: 'right' },
  lockedBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  lockedTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.danger, textAlign: 'center' },
  lockedMeta: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  lockedHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: 8, lineHeight: 17 },
});
