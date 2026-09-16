/**
 * EnrollmentModal — shown the FIRST time a student opens a lesson for a
 * new teacher (or when the teacher has added groups since the student last
 * enrolled and the student has no group yet).
 *
 * Collects:
 *   - full_name_ar: student's full Arabic name (stored globally on User)
 *   - grade:        fixed dropdown — same 4 options as GRADE_LEVELS
 *   - group_id:     which of the teacher's named groups to join (optional when
 *                   the teacher hasn't created any groups yet)
 *
 * Shown as a bottom-sheet overlay on top of the lesson screen. The student
 * cannot dismiss it without submitting (no X button, no back-swipe) — this
 * is intentional: the teacher needs this info for every student.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { submitEnrollment } from '@/lib/api';
import { GRADE_LEVELS } from '@/lib/types';
import type { EnrollmentStatus, GradeLevel, TeacherGroup } from '@/lib/types';
import { colors, fonts, spacing } from '@/constants/theme';

interface Props {
  teacherId: string;
  status: EnrollmentStatus;
  language: 'ar' | 'en';
  /** Called when the form is successfully submitted — parent gets fresh status. */
  onDone: (updated: EnrollmentStatus) => void;
}

const STRINGS: Record<'ar' | 'en', {
  title: string;
  subtitle: string;
  namePlaceholder: string;
  nameLabel: string;
  gradeLabel: string;
  groupLabel: string;
  noGroupHint: string;
  submit: string;
  nameRequired: string;
  gradeRequired: string;
}> = {
  ar: {
    title: 'تسجيل بيانات الطالب',
    subtitle: 'يرجى تعبئة البيانات التالية مرة واحدة فقط.',
    namePlaceholder: 'الاسم بالكامل (بالعربي)',
    nameLabel: 'الاسم',
    gradeLabel: 'الصف الدراسي',
    groupLabel: 'المجموعة',
    noGroupHint: 'لا توجد مجموعات بعد — يمكن تحديدها لاحقاً.',
    submit: 'حفظ وتابع',
    nameRequired: 'يرجى إدخال الاسم',
    gradeRequired: 'يرجى اختيار الصف',
  },
  en: {
    title: 'Student Registration',
    subtitle: 'Please fill in your details once.',
    namePlaceholder: 'Full name (in Arabic)',
    nameLabel: 'Name',
    gradeLabel: 'Grade',
    groupLabel: 'Group',
    noGroupHint: 'No groups yet — can be assigned later.',
    submit: 'Save & Continue',
    nameRequired: 'Please enter your name',
    gradeRequired: 'Please select your grade',
  },
};

export function EnrollmentModal({ teacherId, status, language, onDone }: Props) {
  const t = STRINGS[language];

  // Pre-fill from existing values if re-showing for group assignment only
  const [nameAr, setNameAr] = useState(status.full_name_ar ?? '');
  const [grade, setGrade] = useState<GradeLevel | null>(
    (status.grade as GradeLevel | null) ?? null,
  );
  const [groupId, setGroupId] = useState<string | null>(status.current_group_id);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const groups: TeacherGroup[] = status.available_groups;
  // Only ask for name+grade if they're not set yet
  const needsNameGrade = !status.full_name_ar || !status.grade;
  // Only show group picker if teacher has groups
  const hasGroups = groups.length > 0;

  async function handleSubmit() {
    if (needsNameGrade) {
      if (!nameAr.trim()) { setError(t.nameRequired); return; }
      if (!grade) { setError(t.gradeRequired); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const result = await submitEnrollment(teacherId, {
        full_name_ar: needsNameGrade ? nameAr.trim() : (status.full_name_ar ?? nameAr.trim()),
        grade: needsNameGrade ? grade! : (status.grade as GradeLevel),
        group_id: groupId,
      });
      onDone(result);
    } catch {
      setError('حدث خطأ، حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.subtitle}>{t.subtitle}</Text>

            {/* Name + grade — only shown if not yet collected */}
            {needsNameGrade && (
              <>
                <Text style={styles.label}>{t.nameLabel}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t.namePlaceholder}
                  placeholderTextColor={colors.textFaint}
                  value={nameAr}
                  onChangeText={setNameAr}
                  textAlign={language === 'ar' ? 'right' : 'left'}
                />

                <Text style={styles.label}>{t.gradeLabel}</Text>
                {GRADE_LEVELS.map((gl) => (
                  <Pressable
                    key={gl}
                    style={[styles.option, grade === gl && styles.optionSelected]}
                    onPress={() => setGrade(gl)}>
                    <Text style={[styles.optionText, grade === gl && styles.optionTextSelected]}>
                      {gl}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Group picker */}
            <Text style={styles.label}>{t.groupLabel}</Text>
            {hasGroups ? (
              groups.map((g) => (
                <Pressable
                  key={g.id}
                  style={[styles.option, groupId === g.id && styles.optionSelected]}
                  onPress={() => setGroupId(g.id)}>
                  <Text style={[styles.optionText, groupId === g.id && styles.optionTextSelected]}>
                    {g.name}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.hint}>{t.noGroupHint}</Text>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>{t.submit}</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  title: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.text,
    marginBottom: 8,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 4,
  },
  option: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  optionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    textAlign: 'center',
  },
  optionTextSelected: {
    color: '#fff',
    fontFamily: fonts.semiBold,
  },
  hint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
    marginVertical: 8,
  },
  errorText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.danger,
    textAlign: 'center',
    marginTop: 8,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 16,
  },
});
