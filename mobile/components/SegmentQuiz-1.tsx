import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ImageViewerModal } from '@/components/ImageViewerModal';
import { MathText } from '@/components/MathText';
import { ResolvedImage } from '@/components/ResolvedImage';
import type { Language } from '@/context/LanguageContext';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { Question, QuestionAttemptResult } from '@/lib/types';

const PASS_THRESHOLD = 0.75;

const STRINGS: Record<
  Language,
  {
    title: string;
    check: string;
    checking: string;
    resultHeading: (correct: number, total: number) => string;
    passMessage: string;
    failMessage: string;
    continueButton: string;
    rewatchButton: string;
    correct: string;
    incorrect: string;
    answerPlaceholder: string;
  }
> = {
  ar: {
    title: 'كويز سريع قبل ما نكمل',
    check: 'تحقق من الإجابات',
    checking: 'بيتحقق...',
    resultHeading: (correct, total) => `${correct} من ${total} صح`,
    passMessage: 'تمام! جاهز تكمل باقي المحاضرة.',
    failMessage: 'لازم تحصّل 75% على الأقل — راجع الجزء ده تاني وجرب من جديد.',
    continueButton: 'كمّل المحاضرة',
    rewatchButton: 'شاهد الجزء ده تاني',
    correct: 'صح',
    incorrect: 'غلط',
    answerPlaceholder: 'اكتب إجابتك...',
  },
  en: {
    title: 'Quick check before we continue',
    check: 'Check answers',
    checking: 'Checking...',
    resultHeading: (correct, total) => `${correct}/${total} correct`,
    passMessage: "Nice! You're ready to continue the lecture.",
    failMessage: 'You need at least 75% — rewatch this part and try again.',
    continueButton: 'Continue lecture',
    rewatchButton: 'Rewatch this part',
    correct: 'Correct',
    incorrect: 'Incorrect',
    answerPlaceholder: 'Type your answer...',
  },
};

export function SegmentQuiz({
  language,
  questions,
  onSubmitAnswer,
  onFinish,
}: {
  language: Language;
  questions: Question[];
  onSubmitAnswer: (questionId: string, answer: string) => Promise<QuestionAttemptResult>;
  onFinish: (passed: boolean) => void;
}) {
  const t = STRINGS[language];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, QuestionAttemptResult> | null>(null);
  const [checking, setChecking] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null | undefined>(null);

  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  const onCheck = async () => {
    if (!allAnswered || checking) return;
    setChecking(true);
    try {
      const entries = await Promise.all(
        questions.map(async (q) => [q.id, await onSubmitAnswer(q.id, answers[q.id])] as const),
      );
      setResults(Object.fromEntries(entries));
    } finally {
      setChecking(false);
    }
  };

  const correctCount = results ? questions.filter((q) => results[q.id]?.is_correct).length : 0;
  const passed = results ? correctCount / questions.length >= PASS_THRESHOLD : false;

  return (
    <View style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{t.title}</Text>

        {questions.map((q, index) => {
          const result = results?.[q.id];
          return (
            <View key={q.id} style={styles.card}>
              <Text style={styles.questionIndex}>
                {index + 1}.
              </Text>
              {/* The question is the main event: with no image it takes the
                  whole card width like before; with one, it shares a row with
                  a fixed-size thumbnail on the right instead of a full-width
                  image stacked on top — matches how the image never got to
                  crowd out the actual question text before this pass. See
                  ResolvedImage's resizeMode: 'contain' here (not the old
                  'cover' default) so a circuit diagram or any other non-square
                  image is never cropped, just letterboxed inside its box. */}
              {q.image_url ? (
                <View style={styles.questionRow}>
                  <MathText text={q.prompt} color={colors.text} fontSize={16} style={styles.questionRowText} />
                  <Pressable style={styles.questionImageWrap} onPress={() => setZoomImage(q.image_url)}>
                    <ResolvedImage
                      url={q.image_url}
                      style={styles.questionImage}
                      containerStyle={styles.questionImage}
                      resizeMode="contain"
                    />
                    <View style={styles.zoomBadge}>
                      <Text style={styles.zoomBadgeText}>🔍</Text>
                    </View>
                  </Pressable>
                </View>
              ) : (
                <MathText text={q.prompt} color={colors.text} fontSize={16} />
              )}

              {q.question_type === 'multiple_choice' && q.choices ? (
                <View style={styles.choices}>
                  {Object.entries(q.choices).map(([key, label]) => {
                    const selected = answers[q.id] === key;
                    return (
                      <Pressable
                        key={key}
                        style={[
                          styles.choiceRow,
                          selected && styles.choiceRowSelected,
                          result && selected && (result.is_correct ? styles.choiceRowCorrect : styles.choiceRowWrong),
                        ]}
                        onPress={() => !results && setAnswers((prev) => ({ ...prev, [q.id]: key }))}
                        disabled={!!results}
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
                  onChangeText={(v) => !results && setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                  editable={!results}
                />
              )}

              {result ? (
                <View style={styles.resultRow}>
                  <Text style={[styles.resultBadge, result.is_correct ? styles.resultBadgeGood : styles.resultBadgeBad]}>
                    {result.is_correct ? `✓ ${t.correct}` : `✕ ${t.incorrect}`}
                  </Text>
                  {result.explanation ? <Text style={styles.explanation}>{result.explanation}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {!results ? (
          <Pressable
            style={[styles.checkButton, (!allAnswered || checking) && styles.checkButtonDisabled]}
            onPress={onCheck}
            disabled={!allAnswered || checking}
          >
            {checking ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.checkButtonText}>{t.check}</Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.summary}>
            <Text style={[styles.summaryHeading, passed ? styles.summaryGood : styles.summaryBad]}>
              {t.resultHeading(correctCount, questions.length)}
            </Text>
            <Text style={styles.summaryMessage}>{passed ? t.passMessage : t.failMessage}</Text>
            <Pressable style={styles.finishButton} onPress={() => onFinish(passed)}>
              <Text style={styles.finishButtonText}>{passed ? t.continueButton : t.rewatchButton}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      <ImageViewerModal visible={!!zoomImage} url={zoomImage} onClose={() => setZoomImage(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
  title: { fontSize: 18, color: colors.text, marginBottom: spacing.lg, fontFamily: fonts.bold },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  questionIndex: { color: colors.textFaint, fontSize: 12, marginBottom: 2, fontFamily: fonts.bold },
  // Row: question text (flex, wraps freely) + thumbnail on the right — RN's
  // 'row' lays out left-to-right regardless of the Arabic text's own RTL
  // reading direction inside it, so the image (second child) always ends up
  // on the right of the row exactly where it's meant to sit.
  questionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  questionRowText: { flex: 1 },
  questionImageWrap: { position: 'relative' },
  questionImage: {
    width: 210,
    height: 190,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(5, 7, 12, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBadgeText: { fontSize: 12 },
  choices: { marginTop: spacing.sm, gap: spacing.sm },
  choiceRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  choiceRowSelected: { borderColor: colors.primary },
  choiceRowCorrect: { borderColor: colors.success, backgroundColor: colors.success + '1A' },
  choiceRowWrong: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
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
  resultRow: { marginTop: spacing.sm },
  resultBadge: { fontSize: 13, marginBottom: 4, fontFamily: fonts.bold },
  resultBadgeGood: { color: colors.success },
  resultBadgeBad: { color: colors.danger },
  explanation: { color: colors.textMuted, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  checkButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  checkButtonDisabled: { opacity: 0.5 },
  checkButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
  summary: { alignItems: 'center', marginTop: spacing.md },
  summaryHeading: { fontSize: 20, marginBottom: spacing.xs, fontFamily: fonts.bold },
  summaryGood: { color: colors.success },
  summaryBad: { color: colors.danger },
  summaryMessage: { color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg, fontFamily: fonts.regular },
  finishButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
  },
  finishButtonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
});
