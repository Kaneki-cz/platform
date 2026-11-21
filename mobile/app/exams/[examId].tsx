import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, ZoomIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Celebration } from '@/components/Celebration';
import { ImageViewerModal } from '@/components/ImageViewerModal';
import { MathText } from '@/components/MathText';
import { PhotoAnswer } from '@/components/PhotoAnswer';
import { PressableScale, ProgressRing, enterStagger, useCountUp } from '@/components/motion';
import { ResolvedImage } from '@/components/ResolvedImage';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, fonts, gradientBrand, radius, spacing } from '@/constants/theme';
import { ApiError, getAttemptResult, getExamStatus, saveExamDraft, startExam, submitExam } from '@/lib/api';
import type { ExamAnswerSubmit, ExamQuestionForStudent, ExamStartResult, ExamStatus, ExamSubmitResult } from '@/lib/types';

const STRINGS = {
  ar: {
    loading: 'بيحمل...',
    intro: 'امتحان',
    alreadyPassed: (score: number) => `أنت عديت الامتحان ده قبل كده — أفضل نتيجة ${Math.round(score)}%`,
    startButton: 'ابدأ الامتحان',
    resumeButton: 'كمّل الامتحان',
    retakeButton: 'أعد المحاولة',
    ruleQuestions: (n: number) => `${n} سؤال`,
    ruleTime: (m: number) => `${m} دقيقة`,
    ruleNoTime: 'من غير وقت محدد',
    ruleAttempts: (left: number, max: number) => `فاضل ${left} من ${max} محاولات`,
    ruleUnlimited: 'محاولات مفتوحة',
    timeWarning: 'الوقت بيبدأ أول ما تدوس ابدأ، ومش بيقف لو قفلت التطبيق. إجاباتك بتتحفظ أول بأول.',
    blockedMax: 'خلصت كل المحاولات المسموحة للامتحان ده.',
    blockedCooldown: (when: string) => `تقدر تعيد المحاولة بعد ${when}`,
    blockedNoQuestions: 'الامتحان ده لسه مفيهوش أسئلة.',
    historyTitle: 'محاولاتك السابقة',
    historyRow: (n: number) => `محاولة ${n}`,
    historyAuto: 'اتسلّم تلقائي',
    timerLabel: 'الوقت',
    timeLeft: 'الوقت المتبقي',
    questionProgress: (current: number, total: number) => `سؤال ${current} من ${total}`,
    flag: 'علّم للمراجعة',
    flagged: 'متعلّم',
    prevButton: 'السابق',
    nextButton: 'التالي',
    reviewButton: 'مراجعة وتسليم',
    reviewTitle: 'مراجعة قبل التسليم',
    reviewSummary: (answered: number, total: number) => `جاوبت ${answered} من ${total}`,
    reviewUnanswered: (n: number) => `${n} من غير إجابة`,
    reviewFlagged: (n: number) => `${n} متعلّمين للمراجعة`,
    reviewHint: 'دوس على أي سؤال عشان ترجعله.',
    notAnswered: 'من غير إجابة',
    backToQuestions: 'رجوع للأسئلة',
    submitButton: 'تسليم الامتحان',
    confirmTitle: 'تسلّم الامتحان؟',
    confirmUnanswered: (n: number) => `لسه فيه ${n} سؤال من غير إجابة، وهيتحسبوا غلط.`,
    confirmAll: 'مش هتقدر تغيّر إجاباتك بعد التسليم.',
    cancel: 'إلغاء',
    submitting: 'بيتسلم...',
    answerPlaceholder: 'اكتب إجابتك...',
    timeUp: 'الوقت خلص — الامتحان اتسلّم تلقائي.',
    resultHeading: (correct: number, total: number) => `${correct} من ${total} صح`,
    resultDuration: (mmss: string) => `الوقت المستغرق: ${mmss}`,
    passMessage: 'مبروك! عديت الامتحان.',
    failMessage: 'للأسف مقدرتش تعدي المرة دي.',
    answersHidden: 'الإجابات الصح بتظهر لما تعدّي الامتحان.',
    correctAnswer: 'الإجابة الصح:',
    correct: 'صح',
    incorrect: 'غلط',
    backButton: 'رجوع للفصل',
    tryAgainButton: 'إعادة المحاولة',
    loadError: 'الامتحان مش موجود أو حصلت مشكلة في التحميل.',
    retry: 'جرّب تاني',
    points: (n: number) => `${n} ${n === 1 ? 'درجة' : 'درجات'}`,
    essayPlaceholder: 'اكتب إجابتك بالتفصيل...',
    essayNote: 'سؤال مقالي — حلّه على ورقة وابعت صورة، والمستر هيصححه بنفسه.',
    pendingTitle: 'مستني تصحيح المستر',
    pendingBody: 'إجاباتك المقالية وصلت للمستر. النتيجة النهائية هتظهر هنا أول ما يصححها.',
    pendingSoFar: (earned: number, total: number) => `جمعت ${earned} من ${total} درجة لحد دلوقتي (من غير المقالي)`,
    pendingBadge: 'مستني التصحيح',
    photoAttached: 'صورة الحل مرفوعة',
    graded: 'اتصحح',
    teacherComment: 'تعليق المستر:',
    yourAnswer: 'إجابتك:',
    pointsOf: (got: number, max: number) => `${got}/${max}`,
    historyPending: 'مستني التصحيح',
    viewResult: 'اعرض النتيجة',
    resultPoints: (earned: number, total: number) => `${earned} من ${total} درجة`,
  },
  en: {
    loading: 'Loading...',
    intro: 'Exam',
    alreadyPassed: (score: number) => `You already passed this exam — best score ${Math.round(score)}%`,
    startButton: 'Start exam',
    resumeButton: 'Resume exam',
    retakeButton: 'Retake',
    ruleQuestions: (n: number) => `${n} questions`,
    ruleTime: (m: number) => `${m} min`,
    ruleNoTime: 'No time limit',
    ruleAttempts: (left: number, max: number) => `${left} of ${max} attempts left`,
    ruleUnlimited: 'Unlimited attempts',
    timeWarning: "The clock starts when you tap Start and keeps running if you close the app. Your answers save as you go.",
    blockedMax: "You've used all the attempts allowed for this exam.",
    blockedCooldown: (when: string) => `You can retake it after ${when}`,
    blockedNoQuestions: "This exam doesn't have any questions yet.",
    historyTitle: 'Your previous attempts',
    historyRow: (n: number) => `Attempt ${n}`,
    historyAuto: 'Auto-submitted',
    timerLabel: 'Time',
    timeLeft: 'Time left',
    questionProgress: (current: number, total: number) => `Question ${current} of ${total}`,
    flag: 'Flag for review',
    flagged: 'Flagged',
    prevButton: 'Previous',
    nextButton: 'Next',
    reviewButton: 'Review and submit',
    reviewTitle: 'Review before submitting',
    reviewSummary: (answered: number, total: number) => `${answered} of ${total} answered`,
    reviewUnanswered: (n: number) => `${n} unanswered`,
    reviewFlagged: (n: number) => `${n} flagged`,
    reviewHint: 'Tap any question to go back to it.',
    notAnswered: 'Not answered',
    backToQuestions: 'Back to questions',
    submitButton: 'Submit exam',
    confirmTitle: 'Submit the exam?',
    confirmUnanswered: (n: number) => `${n} question${n === 1 ? ' is' : 's are'} still unanswered and will count as wrong.`,
    confirmAll: "You can't change your answers after submitting.",
    cancel: 'Cancel',
    submitting: 'Submitting...',
    answerPlaceholder: 'Type your answer...',
    timeUp: "Time's up — the exam was submitted automatically.",
    resultHeading: (correct: number, total: number) => `${correct}/${total} correct`,
    resultDuration: (mmss: string) => `Time taken: ${mmss}`,
    passMessage: 'Congrats! You passed.',
    failMessage: "You didn't pass this time.",
    answersHidden: 'Correct answers are shown once you pass the exam.',
    correctAnswer: 'Correct answer:',
    correct: 'Correct',
    incorrect: 'Incorrect',
    backButton: 'Back to chapter',
    tryAgainButton: 'Try again',
    loadError: "This exam doesn't exist, or something went wrong loading it.",
    retry: 'Try again',
    points: (n: number) => `${n} pt${n === 1 ? '' : 's'}`,
    essayPlaceholder: 'Write your full answer...',
    essayNote: 'Essay question — solve it on paper and send a photo; your teacher grades it.',
    pendingTitle: 'Waiting for your teacher',
    pendingBody: "Your written answers were sent to your teacher. Your final score shows up here as soon as they're graded.",
    pendingSoFar: (earned: number, total: number) => `${earned} of ${total} points so far (not counting essays)`,
    pendingBadge: 'Waiting for grading',
    photoAttached: 'Solution photo attached',
    graded: 'Graded',
    teacherComment: "Teacher's comment:",
    yourAnswer: 'Your answer:',
    pointsOf: (got: number, max: number) => `${got}/${max}`,
    historyPending: 'Waiting for grading',
    viewResult: 'View result',
    resultPoints: (earned: number, total: number) => `${earned} of ${total} points`,
  },
};

type Strings = (typeof STRINGS)['en'];

// How long after the last change before answers autosave to the server.
const DRAFT_DEBOUNCE_MS = 800;
// Countdown turns red under this many seconds.
const LOW_TIME_SECONDS = 60;

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function orderedChoices(q: ExamQuestionForStudent): [string, string][] {
  if (!q.choices) return [];
  const keys = q.choice_order?.length ? q.choice_order : Object.keys(q.choices);
  return keys.filter((k) => k in q.choices!).map((k) => [k, q.choices![k]]);
}

function isAnswered(answers: Record<string, string>, id: string) {
  return (answers[id] ?? '').trim().length > 0;
}

export default function ExamScreen() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const router = useRouter();
  const { language } = useLanguage();
  const t = STRINGS[language];

  const [phase, setPhase] = useState<'loading' | 'intro' | 'taking' | 'review' | 'submitting' | 'result' | 'error'>(
    'loading',
  );
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [session, setSession] = useState<ExamStartResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  // Displayable photo for each photo-answered essay question (local file
  // right after taking it, or a signed link when resuming).
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ExamSubmitResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [currentIndex, setCurrentIndex] = useState(0);
  // Server clock minus phone clock, so a phone set a few minutes off can't
  // show the wrong time remaining.
  const clockOffset = useRef(0);
  const submittingRef = useRef(false);

  // Small fade + slide-in every time the visible question changes.
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
        if (s.server_now) clockOffset.current = new Date(s.server_now).getTime() - Date.now();
        setStatus(s);
        setPhase('intro');
      })
      .catch(() => setPhase('error'));
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  const inExam = phase === 'taking' || phase === 'review';

  useEffect(() => {
    if (!inExam) return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [inExam]);

  // Autosave answers + flags, debounced.
  useEffect(() => {
    if (!inExam || !session) return;
    const handle = setTimeout(() => {
      saveExamDraft(session.attempt_id, answers, flagged).catch((e) => {
        // The server already closed this attempt because time ran out —
        // the intro screen will show the result in the history list.
        if (e instanceof ApiError && e.status === 409) {
          setTimedOut(true);
          load();
        }
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [answers, flagged, inExam, session, load]);

  const onStart = async () => {
    if (!examId) return;
    setPhase('loading');
    try {
      const s = await startExam(examId);
      if (s.server_now) clockOffset.current = new Date(s.server_now).getTime() - Date.now();
      setSession(s);
      setAnswers(s.saved_answers ?? {});
      setFlagged(s.flagged_question_ids ?? []);
      setPhotoPreviews(s.saved_answer_images ?? {});
      setResult(null);
      setTimedOut(false);
      submittingRef.current = false;
      setCurrentIndex(0);
      setNowTick(Date.now());
      setPhase('taking');
    } catch (e) {
      // 403 = attempt limit / cooldown reached since the intro loaded.
      if (e instanceof ApiError && e.status === 403) load();
      else setPhase('error');
    }
  };

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (!session || submittingRef.current) return;
      submittingRef.current = true;
      setTimedOut(auto);
      setPhase('submitting');
      try {
        const payload: ExamAnswerSubmit[] = session.questions
          .filter((q) => isAnswered(answers, q.id))
          .map((q) => ({ question_id: q.id, submitted_answer: answers[q.id] }));
        const r = await submitExam(session.attempt_id, payload);
        if (r.auto_submitted) setTimedOut(true);
        setResult(r);
        setPhase('result');
      } catch (e) {
        submittingRef.current = false;
        if (e instanceof ApiError && e.status === 409) load();
        else setPhase('error');
      }
    },
    [session, answers, load],
  );

  // Remaining time (null when the exam has no time limit).
  const remainingSeconds =
    session?.expires_at != null
      ? Math.floor((new Date(session.expires_at).getTime() - (nowTick + clockOffset.current)) / 1000)
      : null;

  useEffect(() => {
    if (inExam && remainingSeconds != null && remainingSeconds <= 0) doSubmit(true);
  }, [inExam, remainingSeconds, doSubmit]);

  const confirmSubmit = () => {
    if (!session) return;
    const unanswered = session.questions.filter((q) => !isAnswered(answers, q.id)).length;
    Alert.alert(t.confirmTitle, unanswered > 0 ? t.confirmUnanswered(unanswered) : t.confirmAll, [
      { text: t.cancel, style: 'cancel' },
      { text: t.submitButton, style: unanswered > 0 ? 'destructive' : 'default', onPress: () => doSubmit(false) },
    ]);
  };

  const openPastResult = async (attemptId: string) => {
    setPhase('loading');
    try {
      const r = await getAttemptResult(attemptId);
      setSession(null);
      setTimedOut(false);
      setResult(r);
      setPhase('result');
    } catch {
      load();
    }
  };

  const toggleFlag = (id: string) =>
    setFlagged((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (phase === 'loading' || phase === 'submitting') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>{phase === 'submitting' ? t.submitting : t.loading}</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="cloud-offline-outline" size={30} color={colors.textMuted} />
        <Text style={styles.errorText}>{t.loadError}</Text>
        <Pressable style={styles.retakeWrap} onPress={load} hitSlop={6}>
          <Text style={styles.retakeText}>{t.retry}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'intro' && status) {
    return <IntroView t={t} status={status} timedOut={timedOut} onStart={onStart} onOpenResult={openPastResult} />;
  }

  if (phase === 'review' && session) {
    const total = session.questions.length;
    const answeredCount = session.questions.filter((q) => isAnswered(answers, q.id)).length;
    const flaggedCount = flagged.filter((id) => session.questions.some((q) => q.id === id)).length;
    return (
      <View style={styles.container}>
        {remainingSeconds != null ? <Countdown t={t} seconds={remainingSeconds} /> : null}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Animated.View entering={FadeInDown.duration(300)} style={styles.summary}>
            <Text style={styles.reviewTitle}>{t.reviewTitle}</Text>
            <Text style={styles.reviewBig}>{t.reviewSummary(answeredCount, total)}</Text>
            <View style={styles.reviewChips}>
              {total - answeredCount > 0 ? (
                <View style={[styles.reviewChip, styles.reviewChipWarn]}>
                  <Text style={[styles.reviewChipText, { color: colors.danger }]}>{t.reviewUnanswered(total - answeredCount)}</Text>
                </View>
              ) : null}
              {flaggedCount > 0 ? (
                <View style={[styles.reviewChip, styles.reviewChipFlag]}>
                  <Ionicons name="flag" size={12} color={colors.accent} />
                  <Text style={[styles.reviewChipText, { color: colors.accent }]}>{t.reviewFlagged(flaggedCount)}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.summarySub}>{t.reviewHint}</Text>
          </Animated.View>

          {session.questions.map((q, i) => {
            const answered = isAnswered(answers, q.id);
            const isFlagged = flagged.includes(q.id);
            const answerText =
              q.question_type === 'multiple_choice' && q.choices
                ? q.choices[answers[q.id]] ?? ''
                : (answers[q.id] ?? '').startsWith('b2:')
                  ? t.photoAttached
                  : answers[q.id] ?? '';
            return (
              <Animated.View key={q.id} entering={enterStagger(i, 80)}>
                <PressableScale
                  style={[styles.reviewRow, !answered && styles.reviewRowMissing]}
                  onPress={() => {
                    setCurrentIndex(i);
                    setPhase('taking');
                  }}
                >
                  <View style={[styles.reviewNum, answered && styles.progressDotAnswered]}>
                    <Text style={styles.progressDotText}>{i + 1}</Text>
                  </View>
                  {answered ? (
                    <MathText text={answerText} color={colors.text} fontSize={14} numberOfLines={1} style={{ flex: 1 }} />
                  ) : (
                    <Text style={[styles.reviewAnswer, { color: colors.danger }]} numberOfLines={1}>
                      {t.notAnswered}
                    </Text>
                  )}
                  {isFlagged ? <Ionicons name="flag" size={15} color={colors.accent} /> : null}
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </PressableScale>
              </Animated.View>
            );
          })}
        </ScrollView>
        <View style={styles.navRow}>
          <Pressable style={styles.navButton} onPress={() => setPhase('taking')}>
            <Text style={styles.navButtonText}>{t.backToQuestions}</Text>
          </Pressable>
          <PressableScale style={styles.submitWrap} onPress={confirmSubmit}>
            <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitButton}>
              <Text style={styles.submitButtonText}>{t.submitButton}</Text>
            </LinearGradient>
          </PressableScale>
        </View>
      </View>
    );
  }

  if (phase === 'taking' && session) {
    const total = session.questions.length;
    const q = session.questions[Math.min(currentIndex, total - 1)];
    const isLast = currentIndex === total - 1;
    const isFlagged = flagged.includes(q.id);
    const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
    const goNext = () => setCurrentIndex((i) => Math.min(total - 1, i + 1));
    const elapsedSeconds = Math.max(
      0,
      Math.floor((nowTick + clockOffset.current - new Date(session.started_at).getTime()) / 1000),
    );

    // Swipe left/right over the question to page; only claims clearly
    // horizontal drags so vertical scrolling of a long question still works.
    const swipeGesture = Gesture.Pan()
      .activeOffsetX([-20, 20])
      .failOffsetY([-15, 15])
      .onEnd((e) => {
        if (e.translationX < -60) runOnJS(goNext)();
        else if (e.translationX > 60) runOnJS(goPrev)();
      });

    return (
      <View style={styles.container}>
        {remainingSeconds != null ? (
          <Countdown t={t} seconds={remainingSeconds} />
        ) : (
          <View style={styles.timerBar}>
            <Ionicons name="time-outline" size={15} color={colors.primary} />
            <Text style={styles.timerText}>
              {t.timerLabel}: {formatDuration(elapsedSeconds)}
            </Text>
          </View>
        )}

        {/* Question navigator: green = answered, orange ring = flagged,
            filled = the one on screen. Tap to jump. */}
        <View style={styles.progressBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.progressDots}>
            {session.questions.map((qq, i) => {
              const answered = isAnswered(answers, qq.id);
              const active = i === currentIndex;
              const qFlagged = flagged.includes(qq.id);
              return (
                <Pressable
                  key={qq.id}
                  onPress={() => setCurrentIndex(i)}
                  hitSlop={4}
                  accessibilityLabel={`${t.questionProgress(i + 1, total)}${qFlagged ? `, ${t.flagged}` : ''}`}
                  style={[
                    styles.progressDot,
                    answered && styles.progressDotAnswered,
                    qFlagged && styles.progressDotFlagged,
                    active && styles.progressDotActive,
                  ]}
                >
                  <Text style={[styles.progressDotText, active && styles.progressDotTextActive]}>{i + 1}</Text>
                  {qFlagged ? <View style={styles.flagPip} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <GestureDetector gesture={swipeGesture}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Animated.View style={[styles.card, questionAnimatedStyle]}>
              <View style={styles.cardHeader}>
                <View style={styles.indexRow}>
                  <Text style={styles.questionIndex}>{t.questionProgress(currentIndex + 1, total)}</Text>
                  <Text style={styles.pointsTag}>{t.points(q.points ?? 1)}</Text>
                </View>
                <Pressable
                  onPress={() => toggleFlag(q.id)}
                  style={[styles.flagButton, isFlagged && styles.flagButtonOn]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isFlagged }}
                >
                  <Ionicons name={isFlagged ? 'flag' : 'flag-outline'} size={14} color={isFlagged ? colors.accent : colors.textMuted} />
                  <Text style={[styles.flagText, isFlagged && { color: colors.accent }]}>{isFlagged ? t.flagged : t.flag}</Text>
                </Pressable>
              </View>
              {q.image_url ? (
                <View style={styles.questionRow}>
                  <MathText text={q.prompt} color={colors.text} fontSize={19} bold style={styles.questionRowText} />
                  <ResolvedImage url={q.image_url} style={styles.questionImage} containerStyle={styles.questionImage} resizeMode="contain" />
                </View>
              ) : (
                <MathText text={q.prompt} color={colors.text} fontSize={19} bold />
              )}

              {q.question_type === 'multiple_choice' && q.choices ? (
                <View style={styles.choices}>
                  {orderedChoices(q).map(([key, label]) => {
                    const selected = answers[q.id] === key;
                    return (
                      <PressableScale
                        key={key}
                        scaleTo={0.98}
                        style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                        onPress={() => setAnswers((prev) => ({ ...prev, [q.id]: key }))}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                      >
                        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                        <MathText
                          text={label}
                          color={selected ? colors.primary : colors.text}
                          fontSize={styles.choiceText.fontSize}
                          bold={selected}
                          style={{ flex: 1 }}
                        />
                      </PressableScale>
                    );
                  })}
                </View>
              ) : q.question_type === 'essay' ? (
                <View>
                  <Text style={styles.essayNote}>{t.essayNote}</Text>
                  <PhotoAnswer
                    attemptId={session.attempt_id}
                    questionId={q.id}
                    value={answers[q.id] ?? ''}
                    previewUri={photoPreviews[q.id] ?? null}
                    language={language}
                    onChange={(answer, preview) => {
                      setAnswers((prev) => ({ ...prev, [q.id]: answer }));
                      setPhotoPreviews((prev) => {
                        const next = { ...prev };
                        if (preview) next[q.id] = preview;
                        else delete next[q.id];
                        return next;
                      });
                    }}
                  />
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

        <View style={styles.navRow}>
          <Pressable
            style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
            onPress={goPrev}
            disabled={currentIndex === 0}
          >
            <Text style={styles.navButtonText}>{t.prevButton}</Text>
          </Pressable>
          <PressableScale style={styles.navButtonPrimaryWrap} onPress={isLast ? () => setPhase('review') : goNext}>
            <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.navButtonPrimary}>
              <Text style={styles.navButtonPrimaryText}>{isLast ? t.reviewButton : t.nextButton}</Text>
            </LinearGradient>
          </PressableScale>
        </View>
      </View>
    );
  }

  if (phase === 'result' && result) {
    const revealed = result.answers_revealed !== false;
    const pending = !!result.pending_review;
    const hasPoints = result.total_points != null && result.total_points !== result.total_count;
    const questionById = new Map((session?.questions ?? []).map((qq) => [qq.id, qq]));
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {timedOut ? (
            <View style={styles.noticeBar}>
              <Ionicons name="alarm-outline" size={16} color={colors.accent} />
              <Text style={styles.noticeText}>{t.timeUp}</Text>
            </View>
          ) : null}
          {pending ? (
            <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.summary}>
              <View style={styles.pendingIcon}>
                <Ionicons name="hourglass-outline" size={34} color={colors.accent} />
              </View>
              <Text style={styles.pendingTitle}>{t.pendingTitle}</Text>
              <Text style={styles.summarySub}>{t.pendingBody}</Text>
              {result.earned_points != null && result.total_points != null ? (
                <Text style={styles.pendingSoFar}>{t.pendingSoFar(result.earned_points, result.total_points)}</Text>
              ) : null}
            </Animated.View>
          ) : null}
          {!pending ? (
          <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.summary}>
            <ProgressRing percent={result.score_percent ?? 0} size={112} stroke={11}>
              <ScoreLabel percent={result.score_percent ?? 0} good={result.passed} />
            </ProgressRing>
            <Animated.Text
              entering={FadeInDown.delay(250)}
              style={[styles.summaryHeading, result.passed ? styles.summaryGood : styles.summaryBad]}
            >
              {hasPoints && result.earned_points != null
                ? t.resultPoints(result.earned_points, result.total_points!)
                : t.resultHeading(result.correct_count, result.total_count)}
            </Animated.Text>
            <Text style={styles.summarySub}>{t.resultDuration(formatDuration(result.duration_seconds))}</Text>
            <Animated.Text entering={FadeInDown.delay(400)} style={styles.summaryMessage}>
              {result.passed ? t.passMessage : t.failMessage}
            </Animated.Text>
            {!revealed ? (
              <View style={styles.hiddenNote}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.textMuted} />
                <Text style={styles.hiddenNoteText}>{t.answersHidden}</Text>
              </View>
            ) : null}
            {result.passed ? <Celebration /> : null}
          </Animated.View>
          ) : null}

          {result.answers.map((a, index) => {
            const qq = questionById.get(a.question_id);
            const correctLabel =
              a.correct_answer != null && qq?.question_type === 'multiple_choice' && qq.choices
                ? qq.choices[a.correct_answer] ?? a.correct_answer
                : a.correct_answer;
            return (
              <Animated.View key={a.question_id} entering={enterStagger(index, 450)} style={styles.card}>
                <View style={styles.indexRow}>
                  <Text style={styles.questionIndex}>{index + 1}.</Text>
                  {a.pending_review ? (
                    <Text style={styles.pointsTag}>{t.points(a.points ?? 1)}</Text>
                  ) : (
                    <Text style={[styles.pointsTag, { color: a.is_correct ? colors.success : colors.textMuted }]}>
                      {t.pointsOf(a.points_awarded ?? 0, a.points ?? 1)}
                    </Text>
                  )}
                </View>
                {a.prompt || qq ? <MathText text={(a.prompt ?? qq?.prompt) as string} color={colors.text} fontSize={14} /> : null}
                <View style={styles.resultRow}>
                  {a.pending_review ? (
                    <View style={styles.resultBadgeRow}>
                      <Ionicons name="hourglass-outline" size={15} color={colors.accent} />
                      <Text style={[styles.resultBadge, { color: colors.accent }]}>{t.pendingBadge}</Text>
                    </View>
                  ) : (
                  <View style={styles.resultBadgeRow}>
                    <Ionicons
                      name={a.is_correct ? 'checkmark-circle' : 'close-circle'}
                      size={16}
                      color={a.is_correct ? colors.success : colors.danger}
                    />
                    <Text style={[styles.resultBadge, a.is_correct ? styles.resultBadgeGood : styles.resultBadgeBad]}>
                      {a.question_type === 'essay' ? t.graded : a.is_correct ? t.correct : t.incorrect}
                    </Text>
                  </View>
                  )}
                  {a.question_type === 'essay' && a.answer_image_url ? (
                    <Pressable onPress={() => setZoomUrl(a.answer_image_url ?? null)} accessibilityRole="imagebutton">
                      <Text style={styles.essayAnswerLabel}>{t.yourAnswer}</Text>
                      <Image source={{ uri: a.answer_image_url }} style={styles.answerPhoto} resizeMode="contain" />
                    </Pressable>
                  ) : a.question_type === 'essay' && a.submitted_answer && !a.submitted_answer.startsWith('b2:') ? (
                    <View style={styles.essayAnswerBox}>
                      <Text style={styles.essayAnswerLabel}>{t.yourAnswer}</Text>
                      <Text style={styles.essayAnswerText}>{a.submitted_answer}</Text>
                    </View>
                  ) : null}
                  {a.teacher_comment ? (
                    <View style={styles.commentBox}>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.primary} />
                      <Text style={styles.commentText}>
                        <Text style={{ fontFamily: fonts.bold }}>{t.teacherComment} </Text>
                        {a.teacher_comment}
                      </Text>
                    </View>
                  ) : null}
                  {!a.is_correct && correctLabel && a.question_type !== 'essay' ? (
                    <View style={styles.correctAnswerRow}>
                      <Text style={styles.correctAnswer}>{t.correctAnswer}</Text>
                      <MathText text={correctLabel} color={colors.success} fontSize={13} style={{ flexShrink: 1 }} />
                    </View>
                  ) : null}
                  {a.explanation ? (
                    <MathText text={a.explanation} color={colors.textMuted} fontSize={13} style={styles.explanation} />
                  ) : null}
                </View>
              </Animated.View>
            );
          })}

          <View style={styles.resultActions}>
            {!result.passed && !pending ? (
              // Back to the intro, which knows whether a retake is allowed
              // right now (attempt limit / cooldown).
              <Pressable style={styles.retakeWrap} onPress={load}>
                <Text style={styles.retakeText}>{t.tryAgainButton}</Text>
              </Pressable>
            ) : null}
            <PressableScale style={styles.backWrap} onPress={() => router.back()}>
              <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.backButton}>
                <Text style={styles.backButtonText}>{t.backButton}</Text>
              </LinearGradient>
            </PressableScale>
          </View>
        </ScrollView>
        <ImageViewerModal visible={!!zoomUrl} url={zoomUrl} onClose={() => setZoomUrl(null)} />
      </View>
    );
  }

  return null;
}

function IntroView({
  t,
  status,
  timedOut,
  onStart,
  onOpenResult,
}: {
  t: Strings;
  status: ExamStatus;
  timedOut: boolean;
  onStart: () => void;
  onOpenResult: (attemptId: string) => void;
}) {
  const resuming = !!status.in_progress_attempt_id;
  const canStart = status.can_start !== false;
  const history = status.history ?? [];
  const blockedText =
    status.blocked_reason === 'max_attempts'
      ? t.blockedMax
      : status.blocked_reason === 'cooldown' && status.next_attempt_at
        ? t.blockedCooldown(formatWhen(status.next_attempt_at))
        : status.blocked_reason === 'no_questions'
          ? t.blockedNoQuestions
          : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.introContent}>
      {timedOut ? (
        <View style={styles.noticeBar}>
          <Ionicons name="alarm-outline" size={16} color={colors.accent} />
          <Text style={styles.noticeText}>{t.timeUp}</Text>
        </View>
      ) : null}

      <Animated.View entering={FadeInDown.duration(350)} style={styles.introCard}>
        <View style={styles.introIcon}>
          <Ionicons name="document-text-outline" size={26} color={colors.primary} />
        </View>
        <Text style={styles.introTitle}>{t.intro}</Text>
        {status.passed ? <Text style={styles.introPassed}>{t.alreadyPassed(status.best_score_percent ?? 0)}</Text> : null}

        <View style={styles.rules}>
          {status.question_count ? <Rule icon="help-circle-outline" text={t.ruleQuestions(status.question_count)} /> : null}
          <Rule
            icon="timer-outline"
            text={status.time_limit_minutes ? t.ruleTime(status.time_limit_minutes) : t.ruleNoTime}
            highlight={!!status.time_limit_minutes}
          />
          <Rule
            icon="repeat-outline"
            text={
              status.max_attempts
                ? t.ruleAttempts(status.attempts_remaining ?? 0, status.max_attempts)
                : t.ruleUnlimited
            }
          />
        </View>

        {status.time_limit_minutes && canStart && !resuming ? <Text style={styles.timeWarning}>{t.timeWarning}</Text> : null}

        {canStart ? (
          <PressableScale style={styles.startWrap} onPress={onStart}>
            <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.startButton}>
              <Text style={styles.startButtonText}>
                {resuming ? t.resumeButton : status.passed || history.length ? t.retakeButton : t.startButton}
              </Text>
            </LinearGradient>
          </PressableScale>
        ) : blockedText ? (
          <View style={styles.blockedBox}>
            <Ionicons
              name={status.blocked_reason === 'cooldown' ? 'hourglass-outline' : 'lock-closed-outline'}
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.blockedText}>{blockedText}</Text>
          </View>
        ) : null}
      </Animated.View>

      {history.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(120)} style={styles.historyCard}>
          <Text style={styles.historyTitle}>{t.historyTitle}</Text>
          {history.map((h, i) => (
            <Pressable
              key={h.attempt_id}
              style={[styles.historyRow, i > 0 && styles.historyRowBorder]}
              onPress={() => onOpenResult(h.attempt_id)}
              accessibilityRole="button"
              accessibilityLabel={`${t.historyRow(history.length - i)} — ${t.viewResult}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.historyLabel}>{t.historyRow(history.length - i)}</Text>
                <Text style={styles.historyMeta}>
                  {h.submitted_at ? formatWhen(h.submitted_at) : ''}
                  {h.duration_seconds != null ? ` · ${formatDuration(h.duration_seconds)}` : ''}
                  {h.auto_submitted ? ` · ${t.historyAuto}` : ''}
                </Text>
              </View>
              {h.pending_review ? (
                <View style={styles.historyPending}>
                  <Ionicons name="hourglass-outline" size={13} color={colors.accent} />
                  <Text style={styles.historyPendingText}>{t.historyPending}</Text>
                </View>
              ) : (
                <Text style={[styles.historyScore, { color: h.passed ? colors.success : colors.danger }]}>
                  {Math.round(h.score_percent ?? 0)}%
                </Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

function Rule({ icon, text, highlight }: { icon: keyof typeof Ionicons.glyphMap; text: string; highlight?: boolean }) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={16} color={highlight ? colors.accent : colors.primary} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function Countdown({ t, seconds }: { t: Strings; seconds: number }) {
  const low = seconds <= LOW_TIME_SECONDS;
  return (
    <View style={[styles.timerBar, low && styles.timerBarLow]} accessibilityLiveRegion={low ? 'polite' : 'none'}>
      <Ionicons name="timer-outline" size={15} color={low ? colors.danger : colors.primary} />
      <Text style={[styles.timerText, low && { color: colors.danger }]}>
        {t.timeLeft}: {formatDuration(seconds)}
      </Text>
    </View>
  );
}

/** The big number inside the result ring — counts up alongside the ring's sweep. */
function ScoreLabel({ percent, good }: { percent: number; good: boolean }) {
  const shown = useCountUp(Math.round(percent), 1300);
  return <Text style={[styles.scoreValue, { color: good ? colors.success : colors.text }]}>{shown}%</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  loadingText: { color: colors.textMuted, marginTop: spacing.md, fontFamily: fonts.regular },
  errorText: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.regular },

  introContent: { padding: spacing.xl, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  introCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: `${colors.violet}33`,
    padding: spacing.xl,
    ...cardShadow,
  },
  introIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  introTitle: { fontSize: 22, color: colors.text, marginBottom: spacing.sm, fontFamily: fonts.bold },
  introPassed: { color: colors.success, marginBottom: spacing.sm, textAlign: 'center', fontFamily: fonts.semiBold },
  rules: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  ruleText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  timeWarning: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.md,
    fontFamily: fonts.regular,
  },
  startWrap: { marginTop: spacing.lg, alignSelf: 'stretch' },
  startButton: { borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center' },
  startButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
  blockedBox: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockedText: { flex: 1, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 20 },

  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  historyTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: spacing.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  historyRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  historyLabel: { color: colors.text, fontFamily: fonts.semiBold, fontSize: 14 },
  historyMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  historyScore: { fontFamily: fonts.bold, fontSize: 17, marginRight: 4 },
  historyPending: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  historyPendingText: { color: colors.accent, fontFamily: fonts.semiBold, fontSize: 12 },
  indexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pointsTag: { color: colors.accent, fontFamily: fonts.bold, fontSize: 11.5, marginBottom: 2 },
  essayNote: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12, marginTop: spacing.md },
  essayInput: { minHeight: 160, lineHeight: 22 },
  charCount: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11, textAlign: 'right', marginTop: 4 },
  pendingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${colors.accent}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  pendingTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 19, marginBottom: spacing.xs },
  pendingSoFar: { color: colors.accent, fontFamily: fonts.semiBold, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  essayAnswerBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  essayAnswerLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11 },
  answerPhoto: { width: '100%', aspectRatio: 0.8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginTop: 4 },
  essayAnswerText: { color: colors.text, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20 },
  commentBox: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: `${colors.primary}12`,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: 4,
  },
  commentText: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },

  noticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: `${colors.accent}1A`,
    borderWidth: 1,
    borderColor: `${colors.accent}55`,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 13.5 },

  timerBar: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  timerBarLow: { backgroundColor: colors.dangerSurface, borderBottomColor: `${colors.danger}55` },
  timerText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },

  progressBar: {
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressDots: { paddingHorizontal: spacing.xl, gap: spacing.xs },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotAnswered: { backgroundColor: colors.success + '26', borderColor: colors.success },
  progressDotFlagged: { borderColor: colors.accent, borderWidth: 2 },
  progressDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  progressDotText: { color: colors.text, fontSize: 13, fontFamily: fonts.bold },
  progressDotTextActive: { color: colors.onPrimary },
  flagPip: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },

  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  questionIndex: { color: colors.textFaint, fontSize: 12, marginBottom: 2, fontFamily: fonts.bold },
  flagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flagButtonOn: { borderColor: `${colors.accent}88`, backgroundColor: `${colors.accent}14` },
  flagText: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.semiBold },
  questionRow: { gap: spacing.md },
  questionRowText: {},
  // % of the row width + aspectRatio so the image scales with the screen.
  // Full width under the prompt, scaled to fit (never cropped) so the whole
  // diagram stays readable.
  questionImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  choices: { marginTop: spacing.md, gap: spacing.sm },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
    backgroundColor: colors.surfaceAlt,
  },
  choiceRowSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  choiceText: { flex: 1, color: colors.text, fontSize: 14.5, fontFamily: fonts.regular },
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

  reviewTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 18 },
  reviewBig: { color: colors.primary, fontFamily: fonts.bold, fontSize: 24, marginTop: spacing.sm },
  reviewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm, justifyContent: 'center' },
  reviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  reviewChipWarn: { borderColor: `${colors.danger}66`, backgroundColor: colors.dangerSurface },
  reviewChipFlag: { borderColor: `${colors.accent}66`, backgroundColor: `${colors.accent}14` },
  reviewChipText: { fontFamily: fonts.semiBold, fontSize: 12.5 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 52,
  },
  reviewRowMissing: { borderColor: `${colors.danger}55` },
  reviewNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctAnswerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  reviewAnswer: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 14 },

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
  submitButton: { borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  submitButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },

  resultRow: { marginTop: spacing.sm, gap: 4 },
  resultBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  resultBadge: { fontSize: 13, fontFamily: fonts.bold },
  resultBadgeGood: { color: colors.success },
  resultBadgeBad: { color: colors.danger },
  correctAnswer: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.medium },
  explanation: { color: colors.textMuted, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  hiddenNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  hiddenNoteText: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.medium },

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
  summaryHeading: { fontSize: 22, marginTop: spacing.md, marginBottom: spacing.xs, fontFamily: fonts.bold },
  scoreValue: { fontSize: 26, fontFamily: fonts.bold, lineHeight: 32 },
  summaryGood: { color: colors.success },
  summaryBad: { color: colors.danger },
  summarySub: { color: colors.textMuted, fontSize: 13, marginTop: 2, fontFamily: fonts.regular, textAlign: 'center' },
  summaryMessage: { color: colors.text, textAlign: 'center', marginTop: spacing.sm, fontFamily: fonts.semiBold },

  resultActions: { marginTop: spacing.md, gap: spacing.sm },
  retakeWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    minHeight: 44,
  },
  retakeText: { color: colors.textMuted, fontFamily: fonts.semiBold },
  backWrap: {},
  backButton: { borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  backButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
});
