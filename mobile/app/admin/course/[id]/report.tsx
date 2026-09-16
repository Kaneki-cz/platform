import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getCourseStudentReport, getExamAttempts, listCourseExams } from '@/lib/api';
import { colors, fonts, spacing } from '@/constants/theme';
import type { CourseStudentReport, ExamAdmin, ExamAttemptRow, StudentReportRow } from '@/lib/types';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Quiet section header — no colored dot, no card wrapper. Matches the
// Teacher Dashboard's own "Simple & Clean" pass (app/admin/dashboard.tsx):
// the two screens should read as one product, and that pass replaced this
// screen's colored-dot header with the same plain label there first.
function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

interface ExamWithAttempts {
  exam: ExamAdmin;
  attempts: ExamAttemptRow[];
}

/**
 * Per-chapter report — reached by tapping a chapter card on the Teacher
 * Dashboard (app/admin/dashboard.tsx). Two sections:
 *
 *  1. "الدرجات" (Grades) — every exam in this chapter, and every completed
 *     attempt on it: student name, score, and time taken. This is what a
 *     teacher actually wants when they ask "who took the exam and what did
 *     they get" — pulled from the same GET /api/v1/exams/{id}/attempts used
 *     by the standalone per-exam Attempts screen
 *     (app/admin/exam/[id]/attempts.tsx), just fetched for every exam in
 *     the chapter at once so it's visible right here without having to dig
 *     into Admin > chapter > Exams > (exam) > Attempts.
 *  2. The original "who hasn't watched / who hasn't taken the exam"
 *     activity report, unchanged in substance. There's no fixed class
 *     roster in this app (any student can open any chapter), so that list
 *     is exactly the students GET /api/v1/courses/{id}/student-report found
 *     real activity for.
 *
 * 2026 "Simple & Clean" redesign pass (second visual pass — the teacher
 * said an earlier, more decorated version of the Dashboard still read as
 * crowded/dated, and asked for one flat, quiet look everywhere): no card
 * borders/shadows, no avatar circles, no colored pill badges. Rows sit
 * directly on the background separated by thin hairline dividers; the
 * only color left is the real status signal (pass/fail score, a fast-
 * attempt flag, a genuine activity gap) — everything else is plain text.
 */
export default function CourseStudentReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<CourseStudentReport | null>(null);
  const [examsWithAttempts, setExamsWithAttempts] = useState<ExamWithAttempts[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      Promise.all([
        getCourseStudentReport(id).catch(() => null),
        listCourseExams(id)
          .then((exams) =>
            Promise.all(
              exams.map((exam) =>
                getExamAttempts(exam.id)
                  .then((data) => ({ exam, attempts: data.attempts }))
                  .catch(() => ({ exam, attempts: [] as ExamAttemptRow[] })),
              ),
            ),
          )
          .catch(() => [] as ExamWithAttempts[]),
      ])
        .then(([reportResult, examsResult]) => {
          setReport(reportResult);
          setExamsWithAttempts(examsResult);
        })
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

  const hasAnyAttempts = examsWithAttempts.some((e) => e.attempts.length > 0);
  const hasActivity = !!report && report.students.length > 0;

  if (!hasAnyAttempts && !hasActivity) {
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
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}>
      {examsWithAttempts.length > 0 ? (
        <>
          <SectionLabel label="الدرجات" />
          {examsWithAttempts.map(({ exam, attempts }, examIndex) => (
            <View key={exam.id} style={[styles.examBlock, examIndex === 0 && styles.examBlockFirst]}>
              <View style={styles.examHeaderRow}>
                <Text style={styles.examTitle} numberOfLines={1}>
                  {exam.title}
                </Text>
                <Text style={styles.examMeta}>
                  {attempts.length} طالب امتحن{attempts.length === 1 ? '' : 'وا'}
                </Text>
              </View>
              {attempts.length === 0 ? (
                <Text style={styles.examEmpty}>محدش امتحن لسه.</Text>
              ) : (
                attempts.map((a, i) => (
                  <View key={a.attempt_id} style={[styles.attemptRow, i === 0 && styles.attemptRowFirst]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attemptName} numberOfLines={1}>
                        {a.full_name?.trim() || a.email}
                      </Text>
                      <Text style={styles.attemptMeta}>
                        ⏱ {formatDuration(a.duration_seconds)} · {formatDateTime(a.submitted_at)}
                        {a.is_fast ? ' · ⚠ سريع بشكل مريب' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.attemptScore, a.passed ? styles.scorePassed : styles.scoreFailed]}>
                      {a.score_percent != null ? `${Math.round(a.score_percent)}%` : '—'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          ))}
        </>
      ) : null}

      {hasActivity && report ? (
        <>
          <SectionLabel label="نشاط الطلاب" />
          <Text style={styles.summary}>
            {report.students.length} طالب تفاعل مع "{report.course_title}" · {report.lectures_count} محاضرات
            {report.exams_count ? ` · ${report.exams_count} امتحان` : ''}
          </Text>
          {report.students.map((s, i) => (
            <StudentRow
              key={s.user_id}
              student={s}
              totalLessons={report.lectures_count}
              totalExams={report.exams_count}
              isFirst={i === 0}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function StudentRow({
  student,
  totalLessons,
  totalExams,
  isFirst,
}: {
  student: StudentReportRow;
  totalLessons: number;
  totalExams: number;
  isFirst: boolean;
}) {
  const lessonsGap = student.missing_lesson_titles.length;
  const examsGap = student.missing_exam_titles.length;
  const displayName = student.full_name?.trim() || student.email;
  return (
    <View style={[styles.row, isFirst && styles.rowFirst]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {student.email}
          </Text>
        </View>
        <View style={styles.stats}>
          {totalLessons > 0 ? (
            <Text style={[styles.statText, lessonsGap > 0 && styles.statTextWarn]}>
              {student.watched_lessons_count}/{totalLessons} محاضرة
            </Text>
          ) : null}
          {totalExams > 0 ? (
            <Text style={[styles.statText, examsGap > 0 && styles.statTextWarn]}>
              {student.attempted_exams_count}/{totalExams} امتحان
            </Text>
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

  sectionLabelRow: { marginTop: 26, marginBottom: 12 },
  sectionLabel: { fontSize: 11, color: colors.textFaint, fontFamily: fonts.semiBold, letterSpacing: 0.6 },

  summary: { fontSize: 12, color: colors.textFaint, fontFamily: fonts.medium, marginBottom: 4, textAlign: 'right' },

  examBlock: { paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
  examBlockFirst: { paddingTop: 0, borderTopWidth: 0 },
  examHeaderRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 },
  examTitle: { fontSize: 14, color: colors.text, fontFamily: fonts.bold, flex: 1, textAlign: 'right' },
  examMeta: { fontSize: 11, color: colors.textFaint, marginStart: 8 },
  examEmpty: { fontSize: 12, color: colors.textFaint, textAlign: 'right', marginTop: 6 },

  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attemptRowFirst: { borderTopWidth: 0 },
  attemptName: { fontSize: 13, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  attemptMeta: { fontSize: 10.5, color: colors.textFaint, marginTop: 2, textAlign: 'right' },
  attemptScore: { fontSize: 15, fontFamily: fonts.bold },
  scorePassed: { color: colors.success },
  scoreFailed: { color: colors.danger },

  row: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border },
  rowFirst: { paddingTop: 0, borderTopWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontSize: 14, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  email: { fontSize: 11, color: colors.textFaint, marginTop: 2, textAlign: 'right' },
  stats: { alignItems: 'flex-end', gap: 3 },
  statText: { fontSize: 11, color: colors.textMuted, fontFamily: fonts.medium },
  statTextWarn: { color: colors.accent, fontFamily: fonts.bold },
  gapLine: { fontSize: 11, color: colors.textMuted, marginTop: 8, textAlign: 'right', lineHeight: 16 },
  skipLine: { fontSize: 11, color: colors.danger, marginTop: 8, textAlign: 'right', fontFamily: fonts.bold },
});
