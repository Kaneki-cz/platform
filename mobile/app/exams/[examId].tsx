import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { MathText } from '@/components/MathText';
import { ResolvedImage } from '@/components/ResolvedImage';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, fonts, gradientBrand, radius, spacing } from '@/constants/theme';
import { getExamStatus, startExam, submitExam } from '@/lib/api';
import type { ExamAnswerSubmit, ExamStartResult, ExamStatus, ExamSubmitResult } from '@/lib/types';

const STRINGS = {
  ar: {
    loading: 'بيحمل...',
    intro: 'امتحان',
    passingBar: (p: number) => `محتاج تعدي بنسبة ${p}% على الأقل`,
    alreadyPassed: (score: number) => `أنت عديت الامتحان ده قبل كده — أفضل نتيجة ${Math.round(score)}%`,
    startButton: 'ابدأ الامتحان',
    resumeButton: 'كمّل الامتحان',
    retakeButton: 'أعد المحاولة',
    timerLabel: 'الوقت',
    questionProgress: (current: number, total: number) => `سؤال ${current} من ${total}`,
    prevButton: 'السابق',
    nextButton: 'التالي',
    submitButton: 'تسليم الامتحان',
    submitting: 'بيتسلم...',
    answerPlaceholder: 'اكتب إجابتك...',
    resultHeading: (correct: number, total: number) => `${correct} من ${total} صح`,
    resultPercent: (p: number) => `النتيجة: ${Math.round(p)}%`,
    resultDuration: (mmss: string) => `الوقت المستغرق: ${mmss}`,
    passMessage: 'مبروك! عديت الامتحان.',
    failMessage: 'للأسف مقدرتش تعدي — تقدر تعيد المحاولة.',
    correct: 'صح',
    incorrect: 'غلط',
    backButton: 'رجوع للفصل',
    tryAgainButton: 'إعادة المحاولة',
    loadError: 'الامتحان مش موجود أو حصلت مشكلة في التحميل.',
  },
  en: {
    loading: 'Loading...',
    intro: 'Exam',
    passingBar: (p: number) => `You need at least ${p}% to pass`,
    alreadyPassed: (score: number) => `You already passed this exam — best score ${Math.round(score)}%`,
    startButton: 'Start exam',
    resumeButton: 'Resume exam',
    retakeButton: 'Retake',
    timerLabel: 'Time',
    questionProgress: (current: number, total: number) => `Question ${current} of ${total}`,
    prevButton: 'Previous',
    nextButton: 'Next',
    submitButton: 'Submit exam',
    submitting: 'Submitting...',
    answerPlaceholder: 'Type your answer...',
    resultHeading: (correct: number, total: number) => `${correct}/${total} correct`,
    resultPercent: (p: number) => `Score: ${Math.round(p)}%`,
    resultDuration: (mmss: string) => `Time taken: ${mmss}`,
    passMessage: 'Congrats! You passed.',
    failMessage: "You didn't pass this time — you can retake it.",
    correct: 'Correct',
    incorrect: 'Incorrect',
    backButton: 'Back to chapter',
    tryAgainButton: 'Try again',
    loadError: "This exam doesn't exist, or something went wrong loading it.",
  },
};

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ExamScreen() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const router = useRouter();
  const { language } = useLanguage();
  const t = STRINGS[language];

  const [phase, setPhase] = useState<'loading' | 'intro' | 'taking' | 'submitting' | 'result' | 'error'>('loading');
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [session, setSession] = useState<ExamStartResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ExamSubmitResult | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // One question shown at a time (see the "next question" navigation
  // request) — index into session.questions, reset to 0 every time a fresh
  // attempt starts in onStart below.
  const [currentIndex, setCurrentIndex] = useState(0);

  // Small fade + slide-in every time the visible question changes (either
  // via the نالتالي/السابق buttons or the swipe gesture below) — makes
  // paging between questions read as "the next card sliding in" instead of
  // an abrupt content swap. Declared unconditionally at the top level (not
  // inside the 'taking'-phase branch below) because hooks can't be called
  // conditionally; it's simply unused while any other phase is showing.
  const questionFade = useSharedValue(0);
  const questionAnimatedStyle = useAnimatedStyle(() => ({
    opacity: questionFade.value,
    transform: [{ translateX: (1 - questionFade.value) * 14 }],
  }));
  useEffect(() => {
    questionFade.value = 0;
    questionFade.value = withTiming(1, { duration: 220 });
  }, [currentIndex, questionFade]);

  const load = useCallback(() => {
    if (!examId) return;
    setPhase('loading');
    getExamStatus(examId)
      .then((s) => {
        setStatus(s);
        setPhase('intro');
      })
      .catch(() => setPhase('error'));
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  // Server-anchored elapsed timer — ticks every second off the wall clock,
  // but the number displayed is always `now - session.started_at` (a
  // server timestamp), never a locally-reset stopwatch. See
  // ExamStartResult.started_at's comment in lib/types.ts.
  useEffect(() => {
    if (phase !== 'taking') return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const onStart = async () => {
    if (!examId) return;
    setPhase('loading');
    try {
      const s = await startExam(examId);
      setSession(s);
      setAnswers({});
      setCurrentIndex(0);
      setNowTick(Date.now());
      setPhase('taking');
    } catch {
      setPhase('error');
    }
  };

  const allAnswered = session ? session.questions.every((q) => (answers[q.id] ?? '').trim().length > 0) : false;

  const onSubmit = async () => {
    if (!session || !allAnswered) return;
    setPhase('submitting');
    try {
      const payload: ExamAnswerSubmit[] = session.questions.map((q) => ({
        question_id: q.id,
        submitted_answer: answers[q.id],
      }));
      const r = await submitExam(session.attempt_id, payload);
      setResult(r);
      setPhase('result');
    } catch {
      setPhase('error');
    }
  };

  if (phase === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>{t.loading}</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{t.loadError}</Text>
      </View>
    );
  }

  if (phase === 'intro' && status) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.introTitle}>{t.intro}</Text>
        {status.passed ? (
          <Text style={styles.introPassed}>{t.alreadyPassed(status.best_score_percent ?? 0)}</Text>
        ) : null}
        <Pressable style={styles.startWrap} onPress={onStart}>
          <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.startButton}>
            <Text style={styles.startButtonText}>
              {status.in_progress_attempt_id ? t.resumeButton : status.passed ? t.retakeButton : t.startButton}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  if (phase === 'taking' && session) {
    const elapsedSeconds = Math.max(0, Math.floor((nowTick - new Date(session.started_at).getTime()) / 1000));
    const total = session.questions.length;
    const q = session.questions[currentIndex];
    const isLast = currentIndex === total - 1;
    const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
    const goNext = () => setCurrentIndex((i) => Math.min(total - 1, i + 1));

    // Swipe left/right anywhere over the question to page, in addition to
    // the نالتالي/السابق buttons. activeOffsetX + failOffsetY make this
    // only claim the gesture once the drag is clearly horizontal, so normal
    // vertical scrolling of a long question inside the ScrollView below
    // still works untouched. goPrev/goNext already clamp at the first/last
    // question, so calling them past either end is a harmless no-op.
    const swipeGesture = Gesture.Pan()
      .activeOffsetX([-20, 20])
      .failOffsetY([-15, 15])
      .onEnd((e) => {
        if (e.translationX < -60) runOnJS(goNext)();
        else if (e.translationX > 60) runOnJS(goPrev)();
      });

    return (
      <View style={styles.container}>
        <View style={styles.timerBar}>
          <Text style={styles.timerText}>
            ⏱ {t.timerLabel}: {formatDuration(elapsedSeconds)}
          </Text>
        </View>

        {/* One question at a time — the student pages through with the
            التالي/السابق nav bar below instead of scrolling past every
            question at once. This dot rail doubles as a jump-to-question
            index: green once answered, so it's easy to spot what's left
            before submit unlocks. */}
        <View style={styles.progressBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.progressDots}>
            {session.questions.map((qq, i) => {
              const answered = (answers[qq.id] ?? '').trim().length > 0;
              const active = i === currentIndex;
              return (
                <Pressable
                  key={qq.id}
                  onPress={() => setCurrentIndex(i)}
                  style={[
                    styles.progressDot,
                    answered && styles.progressDotAnswered,
                    active && styles.progressDotActive,
                  ]}
                >
                  <Text style={[styles.progressDotText, (answered || active) && styles.progressDotTextActive]}>
                    {i + 1}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <GestureDetector gesture={swipeGesture}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
          <Animated.View style={[styles.card, questionAnimatedStyle]}>
            <Text style={styles.questionIndex}>{t.questionProgress(currentIndex + 1, total)}</Text>
            {/* Same "question is the main event" layout as SegmentQuiz —
                full-width text with no image, or text + a large fixed-size
                image on the side when there is one. No tap-to-zoom (removed
                per explicit request) — the inline image is sized big enough
                to read directly; a long question wraps to more lines below
                it rather than ever shrinking the image. Still
                resizeMode: 'contain' so a circuit diagram or any other
                non-square image is never cropped, just letterboxed. */}
            {q.image_url ? (
              <View style={styles.questionRow}>
                <MathText text={q.prompt} color={colors.text} fontSize={19} bold style={styles.questionRowText} />
                <ResolvedImage
                  url={q.image_url}
                  style={styles.questionImage}
                  containerStyle={styles.questionImage}
                  resizeMode="contain"
                />
              </View>
            ) : (
              <MathText text={q.prompt} color={colors.text} fontSize={19} bold />
            )}

            {q.question_type === 'multiple_choice' && q.choices ? (
              <View style={styles.choices}>
                {Object.entries(q.choices).map(([key, label]) => {
                  const selected = answers[q.id] === key;
                  return (
                    <Pressable
                      key={key}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setAnswers((prev) => ({ ...prev, [q.id]: key }))}
                    >
                      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                style={styles.textInput}
                placeholder={t.answerPlaceholder}
                placeholderTextColor={colors.textFaint}
                value={answers[q.id] ?? ''}
                onChangeText={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
              />
            )}
          </Animated.View>
          </ScrollView>
        </GestureDetector>

        {/* Persistent bottom nav bar, always visible regardless of scroll
            position — Submit only ever appears on the last question, and
            stays disabled (see allAnswered above) until every question in
            the whole exam has an answer, not just this one. */}
        <View style={styles.navRow}>
          <Pressable
            style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
            onPress={goPrev}
            disabled={currentIndex === 0}
          >
            <Text style={styles.navButtonText}>{t.prevButton}</Text>
          </Pressable>

          {isLast ? (
            <Pressable
              style={[styles.submitWrap, !allAnswered && styles.submitWrapDisabled]}
              onPress={onSubmit}
              disabled={!allAnswered}
            >
              <LinearGradient
                colors={gradientBrand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitButton}
              >
                <Text style={styles.submitButtonText}>{t.submitButton}</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable style={styles.navButtonPrimaryWrap} onPress={goNext}>
              <LinearGradient
                colors={gradientBrand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.navButtonPrimary}
              >
                <Text style={styles.navButtonPrimaryText}>{t.nextButton}</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (phase === 'submitting') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>{t.submitting}</Text>
      </View>
    );
  }

  if (phase === 'result' && result) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.summary}>
            <Text style={[styles.summaryHeading, result.passed ? styles.summaryGood : styles.summaryBad]}>
              {t.resultHeading(result.correct_count, result.total_count)}
            </Text>
            <Text style={styles.summarySub}>{t.resultPercent(result.score_percent)}</Text>
            <Text style={styles.summarySub}>{t.resultDuration(formatDuration(result.duration_seconds))}</Text>
            <Text style={styles.summaryMessage}>{result.passed ? t.passMessage : t.failMessage}</Text>
          </View>

          {result.answers.map((a, index) => (
            <View key={a.question_id} style={styles.card}>
              <Text style={styles.questionIndex}>{index + 1}.</Text>
              <View style={styles.resultRow}>
                <Text
                  style={[styles.resultBadge, a.is_correct ? styles.resultBadgeGood : styles.resultBadgeBad]}
                >
                  {a.is_correct ? `✓ ${t.correct}` : `✕ ${t.incorrect}`}
                </Text>
                {a.explanation ? (
                  <MathText text={a.explanation} color={colors.textMuted} fontSize={13} style={styles.explanation} />
                ) : null}
              </View>
            </View>
          ))}

          <View style={styles.resultActions}>
            {!result.passed ? (
              <Pressable style={styles.retakeWrap} onPress={onStart}>
                <Text style={styles.retakeText}>{t.tryAgainButton}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.backWrap} onPress={() => router.back()}>
              <LinearGradient
                colors={gradientBrand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>{t.backButton}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: { color: colors.textMuted, marginTop: spacing.md, fontFamily: fonts.regular },
  errorText: { color: colors.danger, textAlign: 'center', fontFamily: fonts.regular },

  introTitle: { fontSize: 22, color: colors.text, marginBottom: spacing.md, fontFamily: fonts.bold },
  introPassed: { color: colors.success, marginBottom: spacing.lg, textAlign: 'center', fontFamily: fonts.semiBold },
  startWrap: { marginTop: spacing.md, width: '100%', maxWidth: 320 },
  startButton: { borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center' },
  startButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },

  timerBar: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  timerText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },

  progressBar: {
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressDots: { paddingHorizontal: spacing.xl, gap: spacing.xs },
  progressDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotAnswered: { backgroundColor: colors.success + '26', borderColor: colors.success },
  progressDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  progressDotText: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.bold },
  progressDotTextActive: { color: colors.onPrimary },

  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  questionIndex: { color: colors.textFaint, fontSize: 12, marginBottom: 2, fontFamily: fonts.bold },
  questionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  questionRowText: { flex: 1 },
  // Sized as a % of the row's own width (not a fixed px number) plus an
  // aspectRatio to derive the height — a fixed px size looked huge on one
  // device and still small on another (this app's tested on both a tablet
  // and a phone), so this scales itself to whatever screen it's on instead
  // of needing another manual bump every time. ~64% of the row leaves the
  // question text a narrower column that wraps to more lines, exactly the
  // trade-off already asked for.
  questionImage: {
    width: '46%',
    aspectRatio: 1.1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  choices: { marginTop: spacing.sm, gap: spacing.sm },
  choiceRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  choiceRowSelected: { borderColor: colors.primary },
  choiceText: { color: colors.text, fontSize: 14, fontFamily: fonts.regular },
  choiceTextSelected: { color: colors.primary, fontFamily: fonts.semiBold },
  textInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    fontFamily: fonts.regular,
  },

  navRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.xl,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navButtonDisabled: { opacity: 0.4 },
  navButtonText: { color: colors.textMuted, fontSize: 15, fontFamily: fonts.semiBold },
  navButtonPrimaryWrap: { flex: 1 },
  navButtonPrimary: { borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  navButtonPrimaryText: { color: colors.onPrimary, fontSize: 15, fontFamily: fonts.bold },

  submitWrap: { flex: 1 },
  submitWrapDisabled: { opacity: 0.5 },
  submitButton: { borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  submitButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },

  resultRow: { marginTop: spacing.sm },
  resultBadge: { fontSize: 13, marginBottom: 4, fontFamily: fonts.bold },
  resultBadgeGood: { color: colors.success },
  resultBadgeBad: { color: colors.danger },
  explanation: { color: colors.textMuted, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },

  summary: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...cardShadow,
  },
  summaryHeading: { fontSize: 22, marginBottom: spacing.xs, fontFamily: fonts.bold },
  summaryGood: { color: colors.success },
  summaryBad: { color: colors.danger },
  summarySub: { color: colors.textMuted, fontSize: 13, marginTop: 2, fontFamily: fonts.regular },
  summaryMessage: { color: colors.text, textAlign: 'center', marginTop: spacing.sm, fontFamily: fonts.semiBold },

  resultActions: { marginTop: spacing.md, gap: spacing.sm },
  retakeWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  retakeText: { color: colors.textMuted, fontFamily: fonts.semiBold },
  backWrap: {},
  backButton: { borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  backButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
});
