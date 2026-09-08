import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, getCourse, listProgress, redeemLessonCode } from '@/lib/api';
import { ResolvedImage } from '@/components/ResolvedImage';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, gradientBrand, radius, spacing } from '@/constants/theme';
import type { CourseDetail, ExamSummary, Lesson } from '@/lib/types';

// The chapter/lecture list interleaves standalone exams with lessons by
// order_index (both share the same numbering space — see
// backend/app/models/exam.py) — this is the merged item type the FlatList
// below actually renders.
type TimelineItem =
  | { kind: 'lesson'; lesson: Lesson; lessonIndex: number }
  | { kind: 'exam'; exam: ExamSummary };

// Same poster-grid visual language as the chapter grid one level up (see
// app/(tabs)/courses/[subjectId]/index.tsx's ACCENT_GRADIENT/SCRIM_GRADIENT)
// — lectures now get the same cover-art card treatment chapters already had,
// so browsing a chapter's lectures feels like the same app as browsing its
// chapters, not a plain list bolted on afterwards.
const ACCENT_GRADIENT = [colors.primary, colors.violet] as const;
const SCRIM_GRADIENT = ['transparent', 'rgba(5, 7, 12, 0.92)'] as const;

const STRINGS = {
  ar: {
    chapterProgress: (percent: number) => `تقدم الفصل: ${percent}%`,
    empty: 'مفيش محاضرات في الفصل ده لسه.',
    locked: 'مقفولة',
    lockedTitle: 'المحاضرة دي مقفولة',
    lockedMessage: 'لازم تعدي كويز المحاضرة اللي قبلها بنسبة 75% على الأقل عشان تفتح.',
    requiresCode: 'محتاجة كود',
    redeemButton: '🔑 فتح بكود',
    redeemTitle: 'أدخل كود الفتح',
    redeemSubtitle: (title: string) => `عشان تفتح "${title}"`,
    redeemPlaceholder: 'مثال: 7F3K-9QRT',
    redeemSubmit: 'فتح',
    redeemCancel: 'إلغاء',
    redeemInvalid: 'الكود ده مش صح. راجعه وحاول تاني.',
    redeemUsed: 'الكود ده مستخدم قبل كده.',
    redeemGenericError: 'حصلت مشكلة. حاول تاني.',
    lockedByExamTitle: 'محتاج تعدي امتحان الأول',
    lockedByExamMessage: 'لازم تعدي الامتحان اللي قبل المحاضرة دي بنسبة النجاح المطلوبة الأول.',
    lockedByExamBadge: 'امتحان مطلوب',
    examBadge: 'امتحان',
    examQuestionCount: (n: number) => `${n} سؤال`,
    examPassed: 'ناجح ✓',
    examStart: 'ابدأ الامتحان',
    examRetake: 'أعد المحاولة',
  },
  en: {
    chapterProgress: (percent: number) => `Chapter progress: ${percent}%`,
    empty: 'No lectures in this chapter yet.',
    locked: 'Locked',
    lockedTitle: 'This lecture is locked',
    lockedMessage: 'Pass the previous lecture’s quiz with at least 75% to unlock it.',
    requiresCode: 'Needs a code',
    redeemButton: '🔑 Unlock with a code',
    redeemTitle: 'Enter your unlock code',
    redeemSubtitle: (title: string) => `To unlock "${title}"`,
    redeemPlaceholder: 'e.g. 7F3K-9QRT',
    redeemSubmit: 'Unlock',
    redeemCancel: 'Cancel',
    redeemInvalid: "That code isn't valid. Double-check it and try again.",
    redeemUsed: 'That code has already been used.',
    redeemGenericError: 'Something went wrong. Please try again.',
    lockedByExamTitle: 'Pass an earlier exam first',
    lockedByExamMessage: 'You need to pass the exam before this lecture with the required score first.',
    lockedByExamBadge: 'Exam required',
    examBadge: 'Exam',
    examQuestionCount: (n: number) => `${n} question${n === 1 ? '' : 's'}`,
    examPassed: 'Passed ✓',
    examStart: 'Start exam',
    examRetake: 'Retake',
  },
};

export default function ChapterLecturesScreen() {
  const { courseId } = useLocalSearchParams<{ subjectId: string; courseId: string }>();
  const router = useRouter();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [progressByLesson, setProgressByLesson] = useState<Record<string, number>>({});
  // The lecture currently being unlocked via the code prompt below — null
  // means the modal is closed. Separate from `locked` (the quiz-sequence
  // lock): a code-gated lecture can need unlocking regardless of quiz
  // progress, see requires_code/code_unlocked on lib/types.ts's Lesson.
  const [redeemTarget, setRedeemTarget] = useState<{ lessonId: string; title: string } | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const reload = useCallback(() => {
    if (!courseId) return;
    getCourse(courseId).then(setCourse).catch(() => {});
  }, [courseId]);

  // useFocusEffect (not useEffect) so a lecture added/edited elsewhere, or
  // progress made in a lecture, shows up here without a full app reload.
  useFocusEffect(
    useCallback(() => {
      reload();
      listProgress()
        .then((entries) => {
          const byLesson: Record<string, number> = {};
          entries.forEach((p) => {
            byLesson[p.lesson_id] = p.completion_percent;
          });
          setProgressByLesson(byLesson);
        })
        .catch(() => {});
    }, [reload]),
  );

  const closeRedeemModal = () => {
    setRedeemTarget(null);
    setCodeInput('');
    setRedeemError(null);
  };

  const onSubmitCode = async () => {
    if (!codeInput.trim() || redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      await redeemLessonCode(codeInput.trim());
      // Re-fetch rather than patch the single lesson locally — a redeemed
      // code can only ever unlock the ONE lecture it was generated for
      // (enforced server-side), but re-fetching is what keeps this screen
      // honest about that instead of assuming it client-side.
      reload();
      closeRedeemModal();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setRedeemError(t.redeemInvalid);
      } else if (e instanceof ApiError && e.status === 409) {
        setRedeemError(t.redeemUsed);
      } else {
        setRedeemError(t.redeemGenericError);
      }
    } finally {
      setRedeeming(false);
    }
  };

  const timeline: TimelineItem[] = useMemo(() => {
    if (!course) return [];
    const items: TimelineItem[] = [
      ...course.lessons.map((lesson, lessonIndex): TimelineItem => ({ kind: 'lesson', lesson, lessonIndex })),
      ...course.exams.map((exam): TimelineItem => ({ kind: 'exam', exam })),
    ];
    const orderOf = (item: TimelineItem) => (item.kind === 'lesson' ? item.lesson.order_index : item.exam.order_index);
    return items.sort((a, b) => orderOf(a) - orderOf(b));
  }, [course]);

  if (!course) return null;

  const lessonPercents = course.lessons.map((l) => progressByLesson[l.id] ?? 0);
  const chapterPercent = lessonPercents.length
    ? Math.round(lessonPercents.reduce((sum, p) => sum + p, 0) / lessonPercents.length)
    : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{course.title}</Text>
      {course.description ? <Text style={styles.description}>{course.description}</Text> : null}
      {course.lessons.length ? (
        <View style={styles.progressBlock}>
          <Text style={styles.chapterProgress}>{t.chapterProgress(chapterPercent)}</Text>
          <View style={styles.progressTrack}>
            {/* Gradient fill (2026 redesign pass) instead of a flat cyan bar —
                matches the app's signature gradient used everywhere else
                (tab bar, avatars, course badges). Purely visual: the same
                chapterPercent width drives it as before. */}
            <LinearGradient
              colors={gradientBrand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${chapterPercent}%` }]}
            />
          </View>
        </View>
      ) : null}

      <FlatList
        data={timeline}
        keyExtractor={(item) => (item.kind === 'lesson' ? item.lesson.id : `exam-${item.exam.id}`)}
        // Same "don't squeeze a single card into a half-width cell" rule as
        // the chapter grid one level up (app/(tabs)/courses/[subjectId]/index.tsx's
        // CourseGrid) — a lone lecture/exam gets one full-width column instead
        // of looking stranded next to empty space. The `key` change (not just
        // `numColumns`) is required for FlatList to actually re-layout — see
        // RN's own "Changing numColumns on the fly is not supported" warning.
        numColumns={timeline.length <= 1 ? 1 : 2}
        key={`timeline-${timeline.length <= 1 ? 1 : 2}col`}
        columnWrapperStyle={timeline.length > 1 ? { gap: spacing.sm } : undefined}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => {
          const isWide = timeline.length <= 1;
          if (item.kind === 'exam') {
            const exam = item.exam;
            return (
              <Pressable
                style={({ pressed }) => [styles.posterCard, pressed && styles.posterCardPressed]}
                onPress={() => router.push(`/exams/${exam.id}`)}
              >
                <View style={[styles.posterCoverWrap, styles.examCoverWrap, isWide && styles.posterCoverWrapWide]}>
                  <View style={[styles.posterCover, styles.examIconFill]}>
                    <Text style={styles.examPosterIcon}>📝</Text>
                  </View>
                  <LinearGradient colors={SCRIM_GRADIENT} style={styles.posterScrim} pointerEvents="none" />
                  <View style={styles.examPosterLabel}>
                    <Text style={styles.examPosterLabelText}>{t.examBadge}</Text>
                  </View>
                  {exam.passed ? (
                    <View style={[styles.posterStatusBadge, styles.statusBadgeDone]}>
                      <Text style={styles.statusIconDone}>✓</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.posterTitle} numberOfLines={2}>
                  {exam.title}
                </Text>
                <Text style={styles.posterSubText}>
                  {t.examQuestionCount(exam.question_count)}
                  {!exam.passed ? ` · ${exam.passed === false ? t.examRetake : t.examStart}` : ''}
                </Text>
              </Pressable>
            );
          }

          const { lesson: lessonItem, lessonIndex: index } = item;
          const percent = progressByLesson[lessonItem.id] ?? 0;
          // A lecture is locked until the one right before it has its
          // segment quizzes cleared (see LessonOut.quiz_passed, computed
          // server-side per student in the backend's get_course) — the
          // first lecture in a chapter is never locked by this rule.
          const locked = index > 0 && !course.lessons[index - 1].quiz_passed;
          // Independent gate: one or more standalone exams earlier in this
          // chapter haven't been passed yet (see Lesson.locked_by_exam,
          // computed server-side — already accounts for
          // exempt_from_exam_gate). Takes precedence over the code gate
          // below since there's no point redeeming a code for a lecture
          // that's still blocked by an earlier exam.
          const examLocked = !locked && lessonItem.locked_by_exam;
          // Separate, independent gate: an instructor/admin generated
          // redemption codes for THIS lecture specifically and this student
          // hasn't unlocked it yet — see requires_code/code_unlocked on
          // lib/types.ts's Lesson. A lecture can need both a passed quiz AND
          // a code; the quiz lock above still takes precedence when both
          // apply, since there's nothing to redeem a code towards until the
          // lecture is even reachable in sequence.
          const codeLocked = !locked && !examLocked && lessonItem.requires_code && !lessonItem.code_unlocked;
          const anyLocked = locked || examLocked || codeLocked;
          return (
            <Pressable
              style={({ pressed }) => [styles.posterCard, pressed && !anyLocked && styles.posterCardPressed]}
              onPress={() => {
                if (locked) {
                  Alert.alert(t.lockedTitle, t.lockedMessage);
                } else if (examLocked) {
                  Alert.alert(t.lockedByExamTitle, t.lockedByExamMessage);
                } else if (codeLocked) {
                  setRedeemTarget({ lessonId: lessonItem.id, title: lessonItem.title });
                } else {
                  router.push(`/lessons/${lessonItem.id}`);
                }
              }}
            >
              {/* Poster-style cover (same treatment as a chapter card): cover
                  art fills the tile, a bottom scrim keeps the index badge
                  legible over any image, and a dark overlay + lock icon marks
                  a locked lecture instead of the old inline lock row. */}
              <View style={[styles.posterCoverWrap, isWide && styles.posterCoverWrapWide]}>
                <ResolvedImage
                  url={lessonItem.cover_image_url}
                  style={styles.posterCover}
                  containerStyle={styles.posterCover}
                  resizeMode="contain"
                  fallback={
                    <View style={[styles.posterCover, styles.photoPlaceholder]}>
                      <Text style={styles.photoPlaceholderText}>🎬</Text>
                    </View>
                  }
                />
                <LinearGradient colors={SCRIM_GRADIENT} style={styles.posterScrim} pointerEvents="none" />
                <LinearGradient
                  colors={ACCENT_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.posterIndexBadge}
                >
                  <Text style={styles.posterIndexBadgeText}>{index + 1}</Text>
                </LinearGradient>

                {anyLocked ? (
                  <View style={styles.posterLockOverlay}>
                    <Text style={styles.posterLockIcon}>{examLocked ? '📝' : codeLocked ? '🔑' : '🔒'}</Text>
                  </View>
                ) : (
                  <View style={styles.posterStatusRow}>
                    {lessonItem.video_url ? (
                      <View style={[styles.posterStatusBadge, styles.statusBadgeVideo]}>
                        <Text style={styles.statusIcon}>▶️</Text>
                      </View>
                    ) : null}
                    {percent >= 100 ? (
                      <View style={[styles.posterStatusBadge, styles.statusBadgeDone]}>
                        <Text style={styles.statusIconDone}>✓</Text>
                      </View>
                    ) : percent > 0 ? (
                      <View style={[styles.posterStatusBadge, styles.statusBadgeProgress]}>
                        <Text style={styles.statusPercentText}>{percent}%</Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
              <Text style={[styles.posterTitle, anyLocked && styles.posterTitleLocked]} numberOfLines={2}>
                {lessonItem.title}
              </Text>
              {locked ? (
                <Text style={styles.lockedText}>{t.locked}</Text>
              ) : examLocked ? (
                <Text style={styles.lockedText}>{t.lockedByExamBadge}</Text>
              ) : codeLocked ? (
                <Text style={styles.codeLockedText}>{t.requiresCode}</Text>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{t.empty}</Text>}
      />

      <Modal visible={redeemTarget !== null} transparent animationType="fade" onRequestClose={closeRedeemModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.redeemTitle}</Text>
            {redeemTarget ? <Text style={styles.modalSubtitle}>{t.redeemSubtitle(redeemTarget.title)}</Text> : null}
            <TextInput
              style={styles.modalInput}
              placeholder={t.redeemPlaceholder}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              value={codeInput}
              onChangeText={(v) => {
                setCodeInput(v);
                setRedeemError(null);
              }}
              editable={!redeeming}
            />
            {redeemError ? <Text style={styles.modalError}>{redeemError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeRedeemModal} disabled={redeeming}>
                <Text style={styles.modalCancelText}>{t.redeemCancel}</Text>
              </Pressable>
              <Pressable
                onPress={onSubmitCode}
                disabled={redeeming || !codeInput.trim()}
                style={[styles.modalSubmitWrap, (redeeming || !codeInput.trim()) && styles.modalSubmitWrapDisabled]}
              >
                <LinearGradient
                  colors={gradientBrand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.modalSubmitButton}
                >
                  {redeeming ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.modalSubmitText}>{t.redeemSubmit}</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  description: { color: colors.textMuted, marginTop: spacing.sm },
  progressBlock: { marginTop: spacing.md },
  chapterProgress: { color: colors.primary, fontWeight: '600', fontSize: 13, marginBottom: 6 },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  // --- Poster-style lecture/exam grid (2026 pass) — replaces the old flat
  // row list with the same cover-art card treatment the chapter grid one
  // level up already uses, so a lecture with a cover image shows it the same
  // way a chapter does, and the whole app feels like one consistent design
  // language instead of the "chapters get posters, lectures get plain rows"
  // split it had before. ----------------------------------------------------
  posterCard: {
    flex: 1,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...cardShadow,
  },
  posterCardPressed: { opacity: 0.85 },
  posterCoverWrap: {
    width: '100%',
    height: 110,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  // Taller poster when it's the only card in the timeline (see `isWide`
  // above) — matches the chapter grid's own courseCoverWrapWide.
  posterCoverWrapWide: { height: 170 },
  posterCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  posterScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  posterIndexBadge: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterIndexBadgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  posterStatusRow: { position: 'absolute', right: spacing.xs, top: spacing.xs, flexDirection: 'row', gap: 4 },
  posterStatusBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  statusBadgeVideo: { backgroundColor: `${colors.primary}CC`, borderWidth: 1, borderColor: `${colors.primary}` },
  statusBadgeDone: { backgroundColor: colors.success },
  statusBadgeProgress: { backgroundColor: `${colors.accent}CC`, borderWidth: 1, borderColor: colors.accent },
  statusIcon: { fontSize: 11 },
  statusIconDone: { color: colors.onPrimary, fontWeight: '800', fontSize: 12 },
  statusPercentText: { color: colors.onPrimary, fontWeight: '700', fontSize: 8.5 },
  // Dark tint + a single icon over the whole cover, replacing the old
  // beside-the-title lock row — reads at a glance even in a small poster.
  posterLockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 12, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterLockIcon: { fontSize: 22 },
  posterTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  posterTitleLocked: { color: colors.textMuted },
  posterSubText: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  lockedText: { color: colors.textFaint, fontSize: 11, fontWeight: '600', marginTop: 2 },
  // Distinct amber tone from the plain quiz-sequence lock above — "needs an
  // action from you" (redeem a code) reads differently from "wait until you
  // clear the previous quiz".
  codeLockedText: { color: colors.accentDark, fontSize: 11, fontWeight: '700', marginTop: 2 },

  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },

  // --- Standalone exam poster — a dashed accent border + a big icon instead
  // of cover art (exams have no image of their own) keeps it visually
  // distinct from a lecture card while still sitting in the same grid. -----
  examCoverWrap: { borderWidth: 1, borderStyle: 'dashed', borderColor: `${colors.accent}88` },
  examIconFill: { alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}14` },
  examPosterIcon: { fontSize: 34 },
  examPosterLabel: {
    position: 'absolute',
    left: spacing.xs,
    top: spacing.xs,
    backgroundColor: `${colors.accent}CC`,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  examPosterLabelText: { color: colors.onPrimary, fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase' },

  // --- Redeem-a-code modal (RN's Alert.prompt is iOS-only, so this app —
  // Android-first — needs its own small dialog instead). ---------------
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...cardShadow,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  modalSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  modalInput: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    letterSpacing: 1,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  modalError: { color: colors.danger, fontSize: 12, marginTop: spacing.sm, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: { color: colors.textMuted, fontWeight: '600' },
  modalSubmitWrap: { flex: 1 },
  modalSubmitWrapDisabled: { opacity: 0.5 },
  modalSubmitButton: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { color: colors.onPrimary, fontWeight: '700' },
});
