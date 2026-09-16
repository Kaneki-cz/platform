import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';

import { getCourseStudentReport } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { icons } from '@/lib/icons';
import type { CourseStudentReport, StudentReportRow } from '@/lib/types';

/**
 * Per-chapter "who hasn't watched / who hasn't taken the exam" report —
 * reached by tapping a chapter card on the Teacher Dashboard
 * (app/admin/dashboard.tsx). There's no fixed class roster in this app (any
 * student can open any chapter), so the list below is exactly the students
 * GET /api/v1/courses/{id}/student-report found real activity for — nothing
 * here is a guessed/expected roster, and a student who's never opened this
 * chapter at all simply never appears in it.
 */
export default function CourseStudentReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<CourseStudentReport | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      getCourseStudentReport(id)
        .then(setReport)
        .catch(() => setReport(null))
        .finally(() => setLoading(false));
    }, [id]),
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!report || report.students.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { padding: spacing.xl }]}>
        <Text style={styles.empty}>
          لسه محدش من الطلاب فتح حاجة في الفصل ده — التقرير هيتملى تلقائي أول ما يبدأوا يتفرجوا على المحاضرات أو ياخدوا
          الامتحانات.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
      data={report.students}
      keyExtractor={(s) => s.user_id}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListHeaderComponent={
        <Text style={styles.summary}>
          {report.students.length} طالب تفاعل مع "{report.course_title}" · {report.lectures_count} محاضرات
          {report.exams_count ? ` · ${report.exams_count} امتحان` : ''}
        </Text>
      }
      renderItem={({ item }) => (
        <StudentRow student={item} totalLessons={report.lectures_count} totalExams={report.exams_count} />
      )}
    />
  );
}

function StudentRow({
  student,
  totalLessons,
  totalExams,
}: {
  student: StudentReportRow;
  totalLessons: number;
  totalExams: number;
}) {
  const lessonsGap = student.missing_lesson_titles.length;
  const examsGap = student.missing_exam_titles.length;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {student.full_name?.trim() || student.email}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {student.email}
          </Text>
        </View>
        <View style={styles.badges}>
          {totalLessons > 0 ? (
            <View style={[styles.badge, lessonsGap > 0 && styles.badgeWarn]}>
              <Image
                source={icons.playCircle}
                style={[styles.badgeIcon, { tintColor: lessonsGap > 0 ? colors.accent : colors.success }]}
              />
              <Text style={[styles.badgeText, lessonsGap > 0 && styles.badgeTextWarn]}>
                {student.watched_lessons_count}/{totalLessons}
              </Text>
            </View>
          ) : null}
          {totalExams > 0 ? (
            <View style={[styles.badge, examsGap > 0 && styles.badgeWarn]}>
              <Image
                source={examsGap > 0 ? icons.warningTriangle : icons.shieldCheck}
                style={[styles.badgeIcon, { tintColor: examsGap > 0 ? colors.accent : colors.success }]}
              />
              <Text style={[styles.badgeText, examsGap > 0 && styles.badgeTextWarn]}>
                {student.attempted_exams_count}/{totalExams}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {lessonsGap > 0 ? (
        <Text style={styles.gapLine} numberOfLines={2}>
          لسه مشافش: {student.missing_lesson_titles.join('، ')}
        </Text>
      ) : null}
      {examsGap > 0 ? (
        <Text style={styles.gapLine} numberOfLines={2}>
          لسه مخدش امتحان: {student.missing_exam_titles.join('، ')}
        </Text>
      ) : null}
      {student.skip_count > 0 ? (
        <Text style={styles.skipLine} numberOfLines={1}>
          ⚠ اتخطى الفيديو {student.skip_count} مرة ({student.skipped_seconds} ثانية)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textFaint, textAlign: 'center', lineHeight: 20 },
  summary: { fontSize: 12, color: colors.textFaint, fontFamily: fonts.medium, marginBottom: 14, textAlign: 'right' },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  email: { fontSize: 11, color: colors.textFaint, marginTop: 2, textAlign: 'right' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.success + '1f',
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  badgeWarn: { backgroundColor: colors.accent + '1f' },
  badgeIcon: { width: 12, height: 12 },
  badgeText: { fontSize: 11, color: colors.success, fontFamily: fonts.bold },
  badgeTextWarn: { color: colors.accent },
  gapLine: { fontSize: 11, color: colors.textMuted, marginTop: 8, textAlign: 'right', lineHeight: 16 },
  skipLine: { fontSize: 11, color: colors.danger, marginTop: 8, textAlign: 'right', fontFamily: fonts.bold },
});
