import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getCourseStudentReport, getExamAttempts, listCourseExams } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';
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

// A student's own account name/email may not be what actually identifies
// them here — matches whatever full_name/email the server sent back for
// this row, which is the same value the row already displays. Kept as one
// helper so the search box and the on-screen name always agree on what
// counts as a match.
function matchesQuery(fullName: string | null, email: string, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (fullName ?? '').toLowerCase().includes(q) || email.toLowerCase().includes(q);
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
  questionCount: number;
  attempts: ExamAttemptRow[];
}

/**
 * Per-chapter report — reached by tapping a chapter card on the Teacher
 * Dashboard (app/admin/dashboard.tsx). Two sections:
 *
 *  1. "الدرجات" (Grades) — every exam in this chapter, and every completed
 *     attempt on it: student name, raw score, percent, and time taken —
 *     pulled from the same GET /api/v1/exams/{id}/attempts used by the
 *     standalone per-exam Attempts screen (app/admin/exam/[id]/attempts.tsx),
 *     just fetched for every exam in the chapter at once.
 *  2. The original "who hasn't watched / who hasn't taken the exam"
 *     activity report. There's no fixed class roster in this app (any
 *     student can open any chapter), so that list is exactly the students
 *     GET /api/v1/courses/{id}/student-report found real activity for.
 *
 * A single search box filters both sections at once by name/email — added
 * because with enough students the two lists got long enough that finding
 * one specific student meant scrolling through everyone.
 *
 * Visual language: the "Simple & Clean" flat style shared with the Teacher
 * Dashboard — no card borders/shadows/avatars/pill badges, thin hairline
 * dividers between rows, color reserved for real status (pass/fail, a
 * fast-attempt flag, an activity gap).
 */
export default function CourseStudentReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<CourseStudentReport | null>(null);
  const [examsWithAttempts, setExamsWithAttempts] = useState<ExamWithAttempts[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

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
                  .then((data) => ({ exam, questionCount: data.question_count, attempts: data.attempts }))
                  .catch(() => ({ exam, questionCount: 0, attempts: [] as ExamAttemptRow[] })),
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

  const filteredExams = useMemo(
    () =>
      examsWithAttempts.map((e) => ({
        ...e,
        attempts: e.attempts.filter((a) => matchesQuery(a.full_name, a.email, query)),
      })),
    [examsWithAttempts, query],
  );
  const filteredStudents = useMemo(
    () => (report?.students ?? []).filter((s) => matchesQuery(s.full_name, s.email, query)),
    [report, query],
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

  // While actively searching, an exam nobody matching took gets hidden
  // entirely rather than shown as an empty block — with no query, every
  // exam still shows (including "محدش امتحن لسه" for one with no attempts
  // at all), same as before.
  const isSearching = query.trim().length > 0;
  const visibleExams = isSearching ? filteredExams.filter((e) => e.attempts.length > 0) : filteredExams;
  const noSearchMatches = isSearching && visibleExams.length === 0 && filteredStudents.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="دور بالاسم أو الإيميل..."
        placeholderTextColor={colors.textFaint}
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {noSearchMatches ? <Text style={styles.empty}>مفيش نتائج لـ "{query.trim()}".</Text> : null}

      {visibleExams.length > 0 ? (
        <>
          <SectionLabel label="الدرجات" />
          {visibleExams.map(({ exam, questionCount, attempts }, examIndex) => (
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
                      <View style={styles.scoreBlock}>
                        <Text style={[styles.attemptScore, a.passed ? styles.scorePassed : styles.scoreFailed]}>
                          {a.correct_count}/{questionCount || '—'}
                        </Text>
                        <Text style={styles.attemptScorePercent}>
                          {a.score_percent != null ? `${Math.round(a.score_percent)}%` : '—'}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
          ))}
        </>
      ) : null}

      {filteredStudents.length > 0 && report ? (
        <>
          <SectionLabel label="نشاط الطلاب" />
          <Text style={styles.summary}>
            {report.students.length} طالب تفاعل مع "{report.course_title}" · {report.lectures_count} محاضرات
            {report.exams_count ? ` · ${report.exams_count} امتحان` : ''}
          </Text>
          {filteredStudents.map((s, i) => (
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

  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
    color: colors.text,
    fontFamily: fonts.medium,
    textAlign: 'right',
    marginBottom: 6,
  },

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
  scoreBlock: { alignItems: 'flex-end' },
  attemptScore: { fontSize: 15, fontFamily: fonts.bold },
  attemptScorePercent: { fontSize: 10, color: colors.textFaint, fontFamily: fonts.medium, marginTop: 1 },
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
