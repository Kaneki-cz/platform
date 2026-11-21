import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  ApiError,
  createExam,
  deleteExam,
  getCourse,
  listCourseExams,
  updateExam,
} from '@/lib/api';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import type { CourseDetail, ExamAdmin } from '@/lib/types';

// Exams' own dedicated section — previously a panel buried at the top of
// the lecture editor (app/admin/course/[id]/index.tsx), now a proper
// destination of its own reached via that screen's "Manage Exams" nav
// card. Same course/chapter id param (nested route, same [id] segment),
// same exam CRUD that used to live there.
//
// Redesign pass: each exam used to be a plain bordered row (title + one
// small gray meta line). Every exam now renders as its own card — an icon
// badge, then its order/passing%/question-count as separate colored chips
// instead of one run-on line — and the add/edit form sits in its own
// clearly-bordered card instead of just floating below the list.
export default function ManageCourseExamsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [exams, setExams] = useState<ExamAdmin[]>([]);
  const [examsLoading, setExamsLoading] = useState(false);

  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examTitle, setExamTitle] = useState('');
  const [examOrderIndex, setExamOrderIndex] = useState('0');
  const [examPassingPercent, setExamPassingPercent] = useState('75');
  // Exam rules — blank text means "no limit".
  const [examTimeLimit, setExamTimeLimit] = useState('');
  const [examMaxAttempts, setExamMaxAttempts] = useState('');
  const [examCooldown, setExamCooldown] = useState('');
  const [examShuffleQuestions, setExamShuffleQuestions] = useState(true);
  const [examShuffleChoices, setExamShuffleChoices] = useState(true);
  const [examShowAnswersOnFail, setExamShowAnswersOnFail] = useState(false);
  const [examSubmitting, setExamSubmitting] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);

  const loadExams = useCallback(() => {
    if (!id) return;
    setExamsLoading(true);
    listCourseExams(id)
      .then(setExams)
      .catch(() => setExams([]))
      .finally(() => setExamsLoading(false));
  }, [id]);

  const load = useCallback(() => {
    if (!id) return;
    getCourse(id).then(setCourse).catch(() => {});
    loadExams();
  }, [id, loadExams]);

  useFocusEffect(load);

  const resetExamForm = () => {
    setEditingExamId(null);
    setExamTitle('');
    setExamOrderIndex('0');
    setExamPassingPercent('75');
    setExamTimeLimit('');
    setExamMaxAttempts('');
    setExamCooldown('');
    setExamShuffleQuestions(true);
    setExamShuffleChoices(true);
    setExamShowAnswersOnFail(false);
    setExamError(null);
  };

  const onEditExamPress = (exam: ExamAdmin) => {
    setEditingExamId(exam.id);
    setExamTitle(exam.title);
    setExamOrderIndex(String(exam.order_index));
    setExamPassingPercent(String(exam.passing_percent));
    setExamTimeLimit(exam.time_limit_minutes ? String(exam.time_limit_minutes) : '');
    setExamMaxAttempts(exam.max_attempts ? String(exam.max_attempts) : '');
    setExamCooldown(exam.retake_cooldown_minutes ? String(exam.retake_cooldown_minutes) : '');
    setExamShuffleQuestions(exam.shuffle_questions ?? true);
    setExamShuffleChoices(exam.shuffle_choices ?? true);
    setExamShowAnswersOnFail(exam.show_answers_on_fail ?? false);
    setExamError(null);
  };

  const onSubmitExam = async () => {
    if (!id || !examTitle.trim() || examSubmitting) return;
    const orderIndex = Number(examOrderIndex.trim());
    const passingPercent = Number(examPassingPercent.trim());
    if (!Number.isInteger(orderIndex)) {
      setExamError('Order must be a whole number — this decides where the exam sits among the lectures.');
      return;
    }
    if (!Number.isInteger(passingPercent) || passingPercent < 1 || passingPercent > 100) {
      setExamError('Passing score must be a whole number between 1 and 100.');
      return;
    }
    const timeLimit = parseOptionalLimit(examTimeLimit);
    const maxAttempts = parseOptionalLimit(examMaxAttempts);
    const cooldown = parseOptionalLimit(examCooldown);
    if (timeLimit === undefined || maxAttempts === undefined || cooldown === undefined) {
      setExamError('Time limit, attempts and wait time must be whole numbers above 0, or left empty for no limit.');
      return;
    }
    const rules = {
      time_limit_minutes: timeLimit,
      max_attempts: maxAttempts,
      retake_cooldown_minutes: cooldown,
      shuffle_questions: examShuffleQuestions,
      shuffle_choices: examShuffleChoices,
      show_answers_on_fail: examShowAnswersOnFail,
    };
    setExamSubmitting(true);
    setExamError(null);
    try {
      if (editingExamId) {
        await updateExam(editingExamId, {
          title: examTitle.trim(),
          order_index: orderIndex,
          passing_percent: passingPercent,
          ...rules,
        });
      } else {
        await createExam({
          course_id: id,
          title: examTitle.trim(),
          order_index: orderIndex,
          passing_percent: passingPercent,
          ...rules,
        });
      }
      resetExamForm();
      loadExams();
    } catch (e) {
      setExamError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setExamSubmitting(false);
    }
  };

  const onDeleteExam = (exam: ExamAdmin) => {
    Alert.alert(
      'Delete this exam?',
      `"${exam.title}" and every question in it will be permanently deleted, and any lecture it was gating will unlock. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteExam(exam.id);
              if (editingExamId === exam.id) resetExamForm();
              loadExams();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
            }
          },
        },
      ],
    );
  };

  if (!course) return null;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      keyboardShouldPersistTaps="handled"
      data={exams}
      keyExtractor={(exam) => exam.id}
      ListHeaderComponent={
        <>
          <View style={styles.eyebrow}>
            <Text style={styles.eyebrowText} numberOfLines={1}>
              📘 {course.title}
            </Text>
          </View>
          <Text style={styles.title}>Exams</Text>
          <Text style={styles.hint}>
            Separate from a lecture's segment quizzes — an exam sits at a specific point among this chapter's
            lectures (by "Order") and locks every lecture after it until a student scores at least the passing %.
            Order works the same way lecture order does: an exam with order 15 sits between lectures ordered 10 and
            20. Add the exam's actual questions from its own "Questions" screen after saving it here.
          </Text>
          {examsLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 4, marginBottom: 4 }} /> : null}
        </>
      }
      renderItem={({ item: exam }) => (
        <Pressable
          style={[styles.card, editingExamId === exam.id && styles.cardEditing]}
          onPress={() => onEditExamPress(exam)}
        >
          <View style={styles.cardTop}>
            <View style={styles.badge}>
              <Text style={styles.badgeIcon}>📝</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {exam.title}
              </Text>
              <View style={styles.chips}>
                <Text style={[styles.chip, styles.chipOrder]}>🔢 order {exam.order_index}</Text>
                <Text style={[styles.chip, styles.chipPass]}>✓ pass ≥{exam.passing_percent}%</Text>
                <Text style={styles.chip}>
                  {exam.question_count} question{exam.question_count === 1 ? '' : 's'}
                  {exam.total_points != null && exam.total_points !== exam.question_count ? ` · ${exam.total_points} pts` : ''}
                </Text>
                {exam.time_limit_minutes ? <Text style={[styles.chip, styles.chipRule]}>⏱ {exam.time_limit_minutes} min</Text> : null}
                {exam.max_attempts ? (
                  <Text style={[styles.chip, styles.chipRule]}>
                    {exam.max_attempts} attempt{exam.max_attempts === 1 ? '' : 's'}
                  </Text>
                ) : null}
                {exam.retake_cooldown_minutes ? (
                  <Text style={[styles.chip, styles.chipRule]}>wait {exam.retake_cooldown_minutes} min</Text>
                ) : null}
              </View>
            </View>
          </View>
          {exam.pending_reviews ? (
            <Pressable
              style={styles.reviewBanner}
              onPress={() => router.push(`/admin/exam/${exam.id}/review`)}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={16} color={colors.accent} />
              <Text style={styles.reviewBannerText}>
                {exam.pending_reviews} essay answer{exam.pending_reviews === 1 ? '' : 's'} to grade
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.accent} />
            </Pressable>
          ) : null}
          <View style={styles.cardActions}>
            <Pressable
              style={[styles.actionButton, styles.actionButtonQuestions]}
              onPress={() => router.push(`/admin/exam/${exam.id}`)}
              hitSlop={6}
            >
              <Ionicons name="list-outline" size={14} color={colors.primary} />
              <Text style={styles.actionButtonQuestionsText}>Questions</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.actionButtonAttempts]}
              onPress={() => router.push(`/admin/exam/${exam.id}/attempts`)}
              hitSlop={6}
            >
              <Ionicons name="people-outline" size={14} color={colors.violet} />
              <Text style={styles.actionButtonAttemptsText}>Attempts</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.actionButtonStats]}
              onPress={() => router.push(`/admin/exam/${exam.id}/analytics`)}
              hitSlop={6}
              accessibilityRole="button"
            >
              <Ionicons name="bar-chart-outline" size={14} color={colors.accent} />
              <Text style={styles.actionButtonStatsText}>Stats</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.actionButtonDelete]}
              onPress={() => onDeleteExam(exam)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${exam.title}`}
            >
              <Ionicons name="trash-outline" size={14} color={colors.danger} />
            </Pressable>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        !examsLoading ? <Text style={styles.empty}>No exams in this chapter yet — add one below.</Text> : null
      }
      ListFooterComponent={
        <View style={[styles.formCard, { marginTop: exams.length ? 16 : 4 }]}>
          {editingExamId ? (
            <View style={styles.editBanner}>
              <Text style={styles.editBannerText}>✏️ Editing "{examTitle || 'this exam'}"</Text>
            </View>
          ) : (
            <Text style={styles.formTitle}>➕ Add an exam</Text>
          )}

          <Text style={styles.smallLabel}>Exam title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Chapter 1 exam"
            placeholderTextColor={colors.textFaint}
            value={examTitle}
            onChangeText={setExamTitle}
          />
          <View style={styles.examFieldsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallLabel}>Order (among lectures)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={examOrderIndex}
                onChangeText={setExamOrderIndex}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallLabel}>Passing score (%)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={examPassingPercent}
                onChangeText={setExamPassingPercent}
              />
            </View>
          </View>

          <Text style={styles.sectionLabel}>Rules</Text>
          <View style={styles.examFieldsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallLabel}>Time limit (min)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="None"
                placeholderTextColor={colors.textFaint}
                value={examTimeLimit}
                onChangeText={setExamTimeLimit}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallLabel}>Max attempts</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="Unlimited"
                placeholderTextColor={colors.textFaint}
                value={examMaxAttempts}
                onChangeText={setExamMaxAttempts}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallLabel}>Wait between (min)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="None"
                placeholderTextColor={colors.textFaint}
                value={examCooldown}
                onChangeText={setExamCooldown}
              />
            </View>
          </View>
          <ToggleRow
            label="Shuffle question order"
            hint="Each student, each attempt gets a different order."
            value={examShuffleQuestions}
            onChange={setExamShuffleQuestions}
          />
          <ToggleRow
            label="Shuffle answer choices"
            hint="Multiple-choice options appear in a different order."
            value={examShuffleChoices}
            onChange={setExamShuffleChoices}
          />
          <ToggleRow
            label="Show answers after a failed attempt"
            hint="Off: correct answers and explanations only show once the student passes."
            value={examShowAnswersOnFail}
            onChange={setExamShowAnswersOnFail}
          />

          {examError ? <Text style={styles.error}>{examError}</Text> : null}
          <View style={styles.formActions}>
            {editingExamId ? (
              <Pressable style={styles.cancelButton} onPress={resetExamForm}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.button, styles.formActionsButton]}
              onPress={onSubmitExam}
              disabled={examSubmitting}
            >
              {examSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{editingExamId ? '💾 Save Changes' : '＋ Add Exam'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      }
    />
  );
}

/** Blank → null (no limit); a positive whole number → that number;
 * anything else → undefined (invalid). */
function parseOptionalLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable style={styles.toggleRow} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary + '88' }}
        thumbColor={value ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  eyebrow: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '24',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  eyebrowText: { color: colors.accent, fontSize: 12, fontFamily: fonts.bold },
  title: { fontSize: 22, fontFamily: fonts.bold, marginBottom: spacing.xs, color: colors.text },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: spacing.md, lineHeight: 18, fontFamily: fonts.regular },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...cardShadow,
  },
  cardEditing: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accent + '2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: { fontSize: 18 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  chipOrder: { color: colors.primary, borderColor: colors.primary + '59', backgroundColor: colors.primary + '1A' },
  chipPass: { color: colors.success, borderColor: colors.success + '59', backgroundColor: colors.success + '1A' },
  chipRule: { color: colors.accent, borderColor: colors.accent + '59', backgroundColor: colors.accent + '1A' },
  sectionLabel: { fontSize: 12, color: colors.textMuted, fontFamily: fonts.bold, marginTop: 4, marginBottom: 6 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toggleLabel: { color: colors.text, fontSize: 13.5, fontFamily: fonts.semiBold },
  toggleHint: { color: colors.textFaint, fontSize: 11.5, fontFamily: fonts.regular, marginTop: 1 },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
    minHeight: 36,
  },
  actionButtonQuestions: { backgroundColor: colors.primary + '1F' },
  actionButtonQuestionsText: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  actionButtonAttempts: { backgroundColor: colors.violet + '1F' },
  actionButtonAttemptsText: { color: colors.violet, fontSize: 12.5, fontFamily: fonts.bold },
  actionButtonStats: { backgroundColor: colors.accent + '1F' },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent + '66',
    backgroundColor: colors.accent + '14',
    minHeight: 40,
  },
  reviewBannerText: { flex: 1, color: colors.accent, fontFamily: fonts.bold, fontSize: 13 },
  actionButtonStatsText: { color: colors.accent, fontSize: 12.5, fontFamily: fonts.bold },
  actionButtonDelete: { backgroundColor: colors.dangerSurface, flex: 0, paddingHorizontal: 12 },
  actionButtonDeleteText: { color: colors.danger, fontSize: 12.5, fontFamily: fonts.bold },

  empty: { color: colors.textFaint, marginVertical: 20, fontFamily: fonts.regular },

  formCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  formTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.sm },
  editBanner: {
    backgroundColor: colors.accent + '1F',
    borderWidth: 1,
    borderColor: colors.accent + '59',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
  },
  editBannerText: { color: colors.accent, fontSize: 12.5, fontFamily: fonts.bold },
  smallLabel: { fontSize: 11, color: colors.textFaint, marginBottom: 4, fontFamily: fonts.medium },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  examFieldsRow: { flexDirection: 'row', gap: 10 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  formActionsButton: { flex: 1.4, marginBottom: 0 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.semiBold },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 16 },
  error: { color: colors.danger, marginBottom: 10, fontFamily: fonts.regular },
});
