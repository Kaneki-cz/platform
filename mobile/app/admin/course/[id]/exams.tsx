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
import { colors, radius, spacing } from '@/constants/theme';
import type { CourseDetail, ExamAdmin } from '@/lib/types';

// Exams' own dedicated section — previously a panel buried at the top of
// the lecture editor (app/admin/course/[id]/index.tsx), now a proper
// destination of its own reached via that screen's "Manage Exams" nav
// card. Same course/chapter id param (nested route, same [id] segment),
// same exam CRUD that used to live there.
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
      data={exams}
      keyExtractor={(exam) => exam.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>{course.title} — Exams</Text>
          <Text style={styles.hint}>
            Separate from a lecture's segment quizzes — an exam sits at a specific point among this chapter's
            lectures (by "Order") and locks every lecture after it until a student scores at least the passing % you
            set here. Use "Order" the same way lecture order works: an exam with order 15 sits between lectures
            ordered 10 and 20. Add the exam's actual questions from its own "Questions" screen after saving it here.
          </Text>
          {examsLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 4, marginBottom: 12 }} /> : null}
        </>
      }
      renderItem={({ item: exam }) => (
        <View style={[styles.row, editingExamId === exam.id && styles.rowEditing]}>
          <Pressable style={{ flex: 1 }} onPress={() => onEditExamPress(exam)}>
            <Text style={styles.rowTitle}>{exam.title}</Text>
            <Text style={styles.rowMeta}>
              order {exam.order_index} · pass ≥{exam.passing_percent}% · {exam.question_count} question
              {exam.question_count === 1 ? '' : 's'}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.push(`/admin/exam/${exam.id}`)} style={{ marginRight: 14 }}>
            <Text style={styles.quizLinkText}>Questions</Text>
          </Pressable>
          <Pressable onPress={() => onDeleteExam(exam)}>
            <Text style={styles.removeText}>Delete</Text>
          </Pressable>
        </View>
      )}
      ListEmptyComponent={
        !examsLoading ? <Text style={styles.empty}>No exams in this chapter yet — add one below.</Text> : null
      }
      ListFooterComponent={
        <>
          <Text style={[styles.label, { marginTop: exams.length ? 16 : 4 }]}>
            {editingExamId ? 'Editing exam — tap another one above to switch, or add a new one below' : 'Add an exam'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Exam title"
            placeholderTextColor="#9ca3af"
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
                <Text style={styles.buttonText}>{editingExamId ? 'Save Changes' : 'Add Exam'}</Text>
              )}
            </Pressable>
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm, color: colors.text },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 10, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowEditing: { backgroundColor: colors.primary + '14', borderRadius: radius.md, paddingHorizontal: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quizLinkText: { color: colors.primary, fontWeight: '600' },
  removeText: { color: colors.danger, fontWeight: '600' },
  empty: { color: colors.textFaint, marginVertical: 20 },
  label: { fontSize: 14, color: colors.textMuted, marginBottom: 4 },
  smallLabel: { fontSize: 11, color: colors.textFaint, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  examFieldsRow: { flexDirection: 'row', gap: 10 },
  formActions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  formActionsButton: { flex: 1, marginBottom: 0 },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  cancelButtonText: { color: colors.textMuted, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 20 },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 10 },
});
