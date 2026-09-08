import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
    setExamError(null);
  };

  const onEditExamPress = (exam: ExamAdmin) => {
    setEditingExamId(exam.id);
    setExamTitle(exam.title);
    setExamOrderIndex(String(exam.order_index));
    setExamPassingPercent(String(exam.passing_percent));
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
    setExamSubmitting(true);
    setExamError(null);
    try {
      if (editingExamId) {
        await updateExam(editingExamId, {
          title: examTitle.trim(),
          order_index: orderIndex,
          passing_percent: passingPercent,
        });
      } else {
        await createExam({
          course_id: id,
          title: examTitle.trim(),
          order_index: orderIndex,
          passing_percent: passingPercent,
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
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.cardActions}>
            <Pressable
              style={[styles.actionButton, styles.actionButtonQuestions]}
              onPress={() => router.push(`/admin/exam/${exam.id}`)}
              hitSlop={6}
            >
              <Text style={styles.actionButtonQuestionsText}>📋 Questions</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.actionButtonDelete]}
              onPress={() => onDeleteExam(exam)}
              hitSlop={6}
            >
              <Text style={styles.actionButtonDeleteText}>🗑 Delete</Text>
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
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionButtonQuestions: { backgroundColor: colors.primary + '1F' },
  actionButtonQuestionsText: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  actionButtonDelete: { backgroundColor: colors.dangerSurface },
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
