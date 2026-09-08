import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getLesson, getLessonQuestions, resolveVideoUrl, submitQuestionAttempt, updateProgress } from '@/lib/api';
import { LessonVideoPlayer, type LessonVideoPlayerHandle } from '@/components/LessonVideoPlayer';
import { SegmentQuiz } from '@/components/SegmentQuiz';
import { useLanguage } from '@/context/LanguageContext';
import { colors, spacing } from '@/constants/theme';
import type { LessonDetail, Question } from '@/lib/types';

// Don't bother persisting the first few seconds of playback — avoids a
// flood of near-zero progress writes the instant the video starts.
const MIN_REPORTABLE_PERCENT = 5;
// Only push a new progress update once watch position has advanced by at
// least this many points since the last one we sent (100 always goes
// through, so finishing early never gets missed).
const PROGRESS_STEP = 10;
const PASS_THRESHOLD = 0.75;

// This screen is student-facing, so its UI text follows the app-wide
// Arabic/English toggle (see context/LanguageContext.tsx) — unlike the
// admin screens, which stay English on purpose.
const STRINGS: Record<'ar' | 'en', { limitReached: string; viewsLabel: (used: number, allowed: number) => string; contactHint: string }> = {
  ar: {
    limitReached: 'لقد استنفذت عدد المشاهدات المسموح بها لهذا الفيديو',
    viewsLabel: (used, allowed) => `المشاهدات: ${used}/${allowed}`,
    contactHint: 'تواصل مع المدرس أو الأدمن لو محتاج مشاهدات إضافية.',
  },
  en: {
    limitReached: "You've used up all the allowed views for this video",
    viewsLabel: (used, allowed) => `Views: ${used}/${allowed}`,
    contactHint: 'Contact your teacher or an admin if you need extra views.',
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
  const lastSentPercent = useRef(0);
  const videoRef = useRef<LessonVideoPlayerHandle>(null);

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
      getLesson(id)
        .then((l) => {
          setLesson(l);
          if (!l.video_url) {
            // No video to track playback of — opening the lecture's text
            // content is the only signal available, so treat it as done.
            updateProgress(id, 100).catch(() => {});
          }
        })
        .catch(() => {});
      getLessonQuestions(id)
        .then(setQuestions)
        .catch(() => {});
    }, [id]),
  );

  // Resolves lesson.video_url (a raw stored value — an external link, a
  // "b2:<key>" marker, or a legacy relative /media/ path) into an actual
  // playable URL. Runs whenever the lesson's video_url changes; a stale
  // in-flight resolution from a previous lesson is discarded via the
  // `cancelled` flag if the user navigates away/to another lesson before it
  // finishes.
  useEffect(() => {
    if (!lesson?.video_url) return undefined;
    let cancelled = false;
    resolveVideoUrl(lesson.video_url)
      .then((url) => {
        if (!cancelled) setResolvedVideoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedVideoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson?.video_url]);

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
      lastSentPercent.current = percent;
      updateProgress(id, percent).catch(() => {});
    },
    [id],
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

  if (!lesson) return null;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>{lesson.title}</Text>

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
          <>
            <LessonVideoPlayer
              ref={videoRef}
              url={resolvedVideoUrl}
              onProgress={onVideoProgress}
              onDurationKnown={setDuration}
              pauseAtSeconds={nextPauseAtSeconds}
              onReachBoundary={onReachBoundary}
            />
            {lesson.views_allowed != null ? (
              <Text style={styles.viewsMeta}>{t.viewsLabel(lesson.views_used ?? 0, lesson.views_allowed)}</Text>
            ) : null}
          </>
        ) : null}

        {lesson.content ? <Text style={styles.content}>{lesson.content}</Text> : null}
      </ScrollView>

      {activeQuiz ? (
        <SegmentQuiz
          language={language}
          questions={activeQuiz.questions}
          onSubmitAnswer={onSubmitAnswer}
          onFinish={onFinishQuiz}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', marginBottom: spacing.lg, color: colors.text },
  content: { fontSize: 16, lineHeight: 24, color: colors.text },
  viewsMeta: { fontSize: 12, color: colors.textFaint, marginTop: 6, textAlign: 'right' },
  lockedBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  lockedTitle: { fontSize: 16, fontWeight: '700', color: colors.danger, textAlign: 'center' },
  lockedMeta: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  lockedHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: 8, lineHeight: 17 },
});
