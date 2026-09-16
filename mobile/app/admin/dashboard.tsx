import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { getApiBaseUrl } from '@/lib/config';
import { getGradesMatrix, getGradesMatrixExportLink, myDashboard } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { chapterTopicIcon } from '@/lib/icons';
import { GRADE_LEVELS } from '@/lib/types';
import type {
  DashboardChapter,
  ExamSpeedFlag,
  GradeLevel,
  GradesMatrixData,
  StudentExamGradeRow,
  TeacherDashboard,
  VideoSkipFlag,
} from '@/lib/types';

// "كل الصفوف" isn't a real GradeLevel value — it's the grades-matrix
// filter's own "no filter" state, kept as a plain sentinel string rather
// than folding null/undefined into the filter's type everywhere it's used.
const ALL_GRADES = 'all' as const;
type GradeFilter = GradeLevel | typeof ALL_GRADES;

/**
 * 2026 "Simple & Clean" redesign pass — replaces the earlier version's
 * per-card borders/shadows, per-item rotating colors, and decorative
 * chrome (icon-wrap circles, colored badges, a gradient hero banner, a
 * tick-ring) with one flat, quiet visual language: a single accent color
 * (colors.primary) used sparingly, generous whitespace instead of boxes,
 * and thin hairline dividers instead of bordered cards. The teacher asked
 * for this directly after two more decorative passes still read as
 * "crowded" and "not modern" — the fix here is less chrome, not more.
 * Numbers and text carry the hierarchy; backgrounds/borders mostly don't.
 */

// Same spirit as WEAK_SCORE_THRESHOLD below, but for the video-activity
// stat — mirrors the backend's own VIDEO_COMPLETED_THRESHOLD /
// VIDEO_LOW_COMPLETION_THRESHOLD (app/api/routes/courses.py) purely for the
// progress-line color cutoff below; the actual completed/low-completion
// COUNTS always come straight from the server, never recomputed here.
const VIDEO_COMPLETION_GOOD_THRESHOLD = 70;

// A chapter's average score below this is called out as the one needing
// review — relative to the rest of this teacher's own chapters, not a
// fixed platform-wide pass bar (that's PASS_THRESHOLD on the backend,
// which gates lecture access; this is just a dashboard nudge).
const WEAK_SCORE_THRESHOLD = 70;

const STRINGS_EMPTY = "لسه معندكش فصول — ضيف فصل من الشاشة اللي فاتت عشان تظهر إحصائياته هنا.";

export default function TeacherDashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<TeacherDashboard | null>(null);
  const [gradesMatrix, setGradesMatrix] = useState<GradesMatrixData | null>(null);
  const [exporting, setExporting] = useState(false);
  // Which "الصف" chip is selected for the grades-matrix section — filters
  // BOTH the on-screen GradesTable groups below AND, via the same value
  // passed as a query param, the Excel download. "all" (the default) means
  // no filter, same as this section's behavior before this filter existed.
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>(ALL_GRADES);

  // "تحميل كملف Excel" — mints a short-lived export token (see
  // getGradesMatrixExportLink) while we still have a normal auth header,
  // then hands the actual .xlsx download to the system browser, since a
  // browser download can't carry our Authorization header itself. The token
  // is single-purpose and expires in 5 minutes (see create_export_token on
  // the backend) — plenty of time for the browser to pick it up, too short
  // to matter if it ends up sitting in browser history. Carries the
  // currently-selected grade chip along as a plain (non-secret) query param
  // — see grades_matrix_export on the backend — so the downloaded file
  // matches whatever's on screen.
  const handleExportExcel = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { token } = await getGradesMatrixExportLink();
      const params = new URLSearchParams({ token });
      if (gradeFilter !== ALL_GRADES) params.set('grade_level', gradeFilter);
      const url = `${getApiBaseUrl()}/api/v1/courses/mine/grades-matrix/export?${params}`;
      await Linking.openURL(url);
    } catch {
      // best-effort — the button itself has no inline error UI yet; a
      // failed mint/openURL just means nothing happens on tap.
    } finally {
      setExporting(false);
    }
  }, [exporting, gradeFilter]);

  useFocusEffect(
    useCallback(() => {
      myDashboard().then(setData).catch(() => {});
      getGradesMatrix().then(setGradesMatrix).catch(() => {});
    }, []),
  );

  // One group per chapter, in the order its rows first appear (the backend
  // already orders rows by chapter) — each group renders as its own small
  // table (see GradesTable) instead of one giant table mixing every
  // chapter's exams together. Filtered by the selected "الصف" chip first
  // (matches Course.grade_level, not the student's own enrolled grade —
  // see StudentExamGradeRow.course_grade_level) so a teacher managing
  // several grade levels only sees/downloads one at a time when they want to.
  const gradesByChapter = useMemo(() => {
    const groups: { courseId: string; courseTitle: string; rows: StudentExamGradeRow[] }[] = [];
    const indexByCourseId = new Map<string, number>();
    const rows =
      gradeFilter === ALL_GRADES
        ? gradesMatrix?.rows ?? []
        : (gradesMatrix?.rows ?? []).filter((r) => r.course_grade_level === gradeFilter);
    for (const row of rows) {
      let idx = indexByCourseId.get(row.course_id);
      if (idx === undefined) {
        idx = groups.length;
        indexByCourseId.set(row.course_id, idx);
        groups.push({ courseId: row.course_id, courseTitle: row.course_title, rows: [] });
      }
      groups[idx].rows.push(row);
    }
    return groups;
  }, [gradesMatrix, gradeFilter]);

  if (!data) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const displayName = user?.full_name?.trim() || user?.email || 'المدرس';
  const initials = displayName.trim().slice(0, 1).toUpperCase();

  const withAttempts = data.chapters.filter((c) => c.exam_attempt_count > 0);
  const perfRows = [...withAttempts].sort((a, b) => (b.avg_score_percent ?? 0) - (a.avg_score_percent ?? 0));
  const weakestId =
    perfRows.length > 0 && (perfRows[perfRows.length - 1].avg_score_percent ?? 100) < WEAK_SCORE_THRESHOLD
      ? perfRows[perfRows.length - 1].id
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetEyebrow}>أهلاً بيك 👋</Text>
          <Text style={styles.greetName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </View>

      {data.chapters_count === 0 ? (
        <Text style={styles.empty}>{STRINGS_EMPTY}</Text>
      ) : (
        <>
          <SectionLabel label="نظرة عامة" />
          <View style={styles.statRow}>
            <StatItem label="الفصول" value={String(data.chapters_count)} />
            <View style={styles.statDivider} />
            <StatItem label="المحاضرات" value={String(data.lectures_count)} />
            <View style={styles.statDivider} />
            <StatItem
              label="متوسط الدرجات"
              value={data.avg_score_percent != null ? `${Math.round(data.avg_score_percent)}%` : '—'}
            />
            <View style={styles.statDivider} />
            <StatItem
              label="نسبة النجاح"
              value={data.pass_rate_percent != null ? `${Math.round(data.pass_rate_percent)}%` : '—'}
            />
          </View>

          {perfRows.length > 0 ? (
            <>
              <SectionLabel label="أداء الطلاب حسب الفصل" />
              <View>
                {perfRows.map((c, index) => {
                  const isWeakest = c.id === weakestId;
                  const score = Math.round(c.avg_score_percent ?? 0);
                  return (
                    <View key={c.id} style={[styles.perfRow, index === 0 && styles.perfRowFirst]}>
                      <View style={styles.perfTop}>
                        <Text style={styles.perfIndex}>{index + 1}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.perfName} numberOfLines={1}>
                            {c.title}
                          </Text>
                          <Text style={styles.perfMeta}>
                            {c.exam_attempt_count} محاولة امتحان
                            {isWeakest ? ' · ⚠ أضعف فصل، يحتاج مراجعة' : ''}
                          </Text>
                        </View>
                        <Text style={[styles.perfScore, isWeakest && { color: colors.accent }]}>{score}%</Text>
                      </View>
                      <View style={styles.track}>
                        <View
                          style={[
                            styles.fill,
                            { width: `${Math.min(100, Math.max(2, score))}%` },
                            isWeakest && styles.fillWarn,
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {(gradesMatrix?.rows?.length ?? 0) > 0 ? (
            <>
              <View style={styles.gradesHeaderRow}>
                <View style={{ flex: 1 }}>
                  <SectionLabel label="درجات الطلاب في الامتحانات" />
                  <Text style={styles.hint}>
                    درجة كل طالب في كل امتحان، ومتوسطه على آخر 30 يوم ومتوسطه في الفصل ده كامل.
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.exportButton, pressed && styles.exportButtonPressed]}
                  onPress={handleExportExcel}
                  disabled={exporting}
                >
                  {exporting ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.exportButtonText}>تحميل Excel</Text>
                  )}
                </Pressable>
              </View>
              <GradeFilterChips selected={gradeFilter} onSelect={setGradeFilter} />
              {gradesByChapter.length > 0 ? (
                gradesByChapter.map((group) => (
                  <GradesTable key={group.courseId} courseTitle={group.courseTitle} rows={group.rows} />
                ))
              ) : (
                <Text style={styles.soonText}>مفيش نتايج للصف ده — جرّب صف تاني أو "الكل".</Text>
              )}
            </>
          ) : null}

          {(data.exam_speed_flags ?? []).length > 0 ? (
            <>
              <SectionLabel label="امتحانات بسرعة مريبة" />
              <Text style={styles.hint}>متوسط الوقت لكل سؤال قليل جداً — مش بالضرورة غش، بس يستاهل نظرة.</Text>
              {(data.exam_speed_flags ?? []).map((f, index) => (
                <ExamSpeedFlagRow key={`${f.user_id}-${f.exam_title}-${index}`} flag={f} />
              ))}
            </>
          ) : null}

          <SectionLabel label="الفصول" />
          <Text style={styles.hint}>اضغط على أي فصل عشان تشوف تقرير الطلاب بتاعه</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chapScroll}>
            {data.chapters.map((c) => (
              <ChapterCard key={c.id} chapter={c} onPress={() => router.push(`/admin/course/${c.id}/report`)} />
            ))}
          </ScrollView>

          <SectionLabel label="نشاط المشاهدة" />
          {data.video_activity ? (
            <View>
              <View style={styles.watchTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.watchTitle}>متوسط نسبة المشاهدة</Text>
                  <Text style={styles.watchMeta}>
                    {data.video_activity.watched_lessons_count} محاضرة اتشافت من أصل {data.lectures_count} ·{' '}
                    {data.video_activity.total_views} مشاهدة مسجلة
                  </Text>
                </View>
                <Text style={styles.watchPercent}>{Math.round(data.video_activity.avg_completion_percent)}%</Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${Math.min(100, Math.max(2, Math.round(data.video_activity.avg_completion_percent)))}%`,
                      backgroundColor:
                        data.video_activity.avg_completion_percent >= VIDEO_COMPLETION_GOOD_THRESHOLD
                          ? colors.primary
                          : colors.accent,
                    },
                  ]}
                />
              </View>
              <Text style={styles.watchSummary}>
                <Text style={styles.watchSummaryN}>{data.video_activity.completed_views_count}</Text> خلّصوا الفيديو
                كامل · <Text style={styles.watchSummaryN}>{data.video_activity.low_completion_views_count}</Text>{' '}
                متخطيين نص الفيديو
              </Text>
            </View>
          ) : (
            <Text style={styles.soonText}>
              لسه معندناش بيانات مشاهدة — هتظهر هنا تلقائي أول ما الطلاب يبدأوا يتفرجوا على محاضرات الفيديو.
            </Text>
          )}

          {(data.video_skip_flags ?? []).length > 0 ? (
            <>
              <SectionLabel label="طلاب بيتخطوا الفيديو" />
              <Text style={styles.hint}>لقّطوا/سحبوا الفيديو للأمام أكتر من مرة بدل ما يتفرجوا عليه فعلاً.</Text>
              {(data.video_skip_flags ?? []).map((f, index) => (
                <VideoSkipFlagRow key={`${f.user_id}-${f.lesson_title}-${index}`} flag={f} />
              ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ExamSpeedFlagRow({ flag }: { flag: ExamSpeedFlag }) {
  return (
    <View style={styles.flagRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.flagName} numberOfLines={1}>
          {flag.full_name?.trim() || flag.email}
        </Text>
        <Text style={styles.flagMeta} numberOfLines={1}>
          {flag.exam_title} · {flag.course_title}
        </Text>
      </View>
      <Text style={styles.flagStatValue}>
        {flag.seconds_per_question.toFixed(1)}s <Text style={styles.flagStatLabel}>/ سؤال</Text>
      </Text>
    </View>
  );
}

function VideoSkipFlagRow({ flag }: { flag: VideoSkipFlag }) {
  return (
    <View style={styles.flagRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.flagName} numberOfLines={1}>
          {flag.full_name?.trim() || flag.email}
        </Text>
        <Text style={styles.flagMeta} numberOfLines={1}>
          {flag.lesson_title} · {flag.course_title}
        </Text>
      </View>
      <Text style={styles.flagStatValue}>
        {flag.skip_count}× <Text style={styles.flagStatLabel}>({flag.skipped_seconds} ث)</Text>
      </Text>
    </View>
  );
}

// "الصف" filter chips for the grades-matrix section — "الكل" (no filter,
// the default) plus one chip per GRADE_LEVELS entry. Filters both the
// on-screen GradesTable groups (see gradesByChapter above) and, via the
// same value, the Excel export — kept as simple pressable pills rather
// than a native picker/modal to match this screen's flat, chrome-light
// style (see the file's "Simple & Clean" note at the top).
function GradeFilterChips({
  selected,
  onSelect,
}: {
  selected: GradeFilter;
  onSelect: (grade: GradeFilter) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gradeChipsScroll}>
      <Pressable
        style={[styles.gradeChip, selected === ALL_GRADES && styles.gradeChipActive]}
        onPress={() => onSelect(ALL_GRADES)}
      >
        <Text style={[styles.gradeChipText, selected === ALL_GRADES && styles.gradeChipTextActive]}>الكل</Text>
      </Pressable>
      {GRADE_LEVELS.map((grade) => (
        <Pressable
          key={grade}
          style={[styles.gradeChip, selected === grade && styles.gradeChipActive]}
          onPress={() => onSelect(grade)}
        >
          <Text style={[styles.gradeChipText, selected === grade && styles.gradeChipTextActive]} numberOfLines={1}>
            {grade}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// One chapter's grades matrix — a small, horizontally-scrollable table
// (student → code placeholder → exam → score → 30-day average → chapter
// average), grouped per chapter so a teacher managing several chapters
// doesn't see one giant table mixing every exam together. student_code is
// always "—" for now: the per-student QR/code feature hasn't been built
// yet (see StudentExamGradeRow's own comment) — the column is here so nothing
// needs to change in this table once it exists.
function GradesTable({ courseTitle, rows }: { courseTitle: string; rows: StudentExamGradeRow[] }) {
  return (
    <View style={styles.gradesTableBlock}>
      <Text style={styles.gradesTableTitle} numberOfLines={1}>
        {courseTitle}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.gradesRow}>
            <Text style={[styles.gradesHeaderCell, gradesCols.name]}>الطالب</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.code]}>الكود</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.chapter]}>الفصل</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.exam]}>الامتحان</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.score]}>الدرجة</Text>
            {/* "متوسط الشهر"/"متوسط الفصل" repeat the "الفصل" column's value in
                every row (not just once per group) — the user flagged that
                relying on the table's own per-chapter grouping to know which
                chapter an average was scoped to was ambiguous, so each row now
                spells it out on its own, both here and in the Excel export. */}
            <Text style={[styles.gradesHeaderCell, gradesCols.avg]}>متوسط الشهر</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.avg]}>متوسط الفصل</Text>
          </View>
          {rows.map((r, i) => (
            <View key={`${r.exam_id}-${r.user_id}-${i}`} style={[styles.gradesRow, i % 2 === 1 && styles.gradesRowAlt]}>
              <Text style={[styles.gradesCell, gradesCols.name, styles.gradesCellBold]} numberOfLines={1}>
                {r.full_name?.trim() || r.email}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.code]}>{r.student_code ?? '—'}</Text>
              <Text style={[styles.gradesCell, gradesCols.chapter]} numberOfLines={1}>
                {r.course_title}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.exam]} numberOfLines={1}>
                {r.exam_title}
              </Text>
              <Text
                style={[
                  styles.gradesCell,
                  gradesCols.score,
                  styles.gradesCellBold,
                  r.passed ? styles.gradesScorePassed : styles.gradesScoreFailed,
                ]}
              >
                {r.correct_count}/{r.question_count || '—'}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.avg]}>
                {r.month_avg_score_percent != null ? `${Math.round(r.month_avg_score_percent)}%` : '—'}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.avg]}>
                {r.chapter_avg_score_percent != null ? `${Math.round(r.chapter_avg_score_percent)}%` : '—'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const gradesCols = StyleSheet.create({
  name: { width: 120 },
  code: { width: 56 },
  chapter: { width: 130 },
  exam: { width: 140 },
  score: { width: 60 },
  avg: { width: 76 },
});

function ChapterCard({ chapter, onPress }: { chapter: DashboardChapter; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.chapCard, pressed && styles.chapCardPressed]} onPress={onPress}>
      <View style={styles.chapCover}>
        <Image source={chapterTopicIcon(chapter.title)} style={styles.chapIcon} />
      </View>
      <Text style={styles.chapTitle} numberOfLines={2}>
        {chapter.title}
      </Text>
      <View style={styles.chapMeta}>
        <Text style={styles.chapMetaText}>{chapter.lecture_count} محاضرات</Text>
        <Text style={styles.chapMetaText}>
          {chapter.avg_score_percent != null ? `${Math.round(chapter.avg_score_percent)}%` : '—'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40 },
  centered: { alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  greetEyebrow: { fontSize: 12, color: colors.textFaint, fontFamily: fonts.medium, marginBottom: 3 },
  greetName: { fontSize: 20, color: colors.text, fontFamily: fonts.bold },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: spacing.md,
  },
  avatarText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 15 },

  // Single quiet section header — no colored dot, no card wrapper. A
  // little top margin gives each section room without boxing it in.
  sectionLabelRow: { marginTop: 26, marginBottom: 12 },
  sectionLabel: { fontSize: 11, color: colors.textFaint, fontFamily: fonts.semiBold, letterSpacing: 0.6 },
  hint: { fontSize: 11.5, color: colors.textFaint, lineHeight: 16, marginBottom: 10, textAlign: 'right' },

  // KPI strip — one flat row, thin dividers between columns, no per-tile
  // card/border/icon. The numbers themselves carry all the weight.
  statRow: { flexDirection: 'row', alignItems: 'stretch' },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: colors.border, marginVertical: 2 },
  statValue: { fontSize: 21, color: colors.text, fontFamily: fonts.bold, marginBottom: 4 },
  statLabel: { fontSize: 10.5, color: colors.textFaint, fontFamily: fonts.medium, textAlign: 'center' },

  perfRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border },
  perfRowFirst: { borderTopWidth: 0, paddingTop: 0 },
  perfTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  perfIndex: { width: 16, fontSize: 12, color: colors.textFaint, fontFamily: fonts.semiBold, textAlign: 'center' },
  perfName: { fontSize: 13.5, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  perfMeta: { fontSize: 11, color: colors.textFaint, marginTop: 1, textAlign: 'right' },
  perfScore: { fontSize: 14, color: colors.text, fontFamily: fonts.bold },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  fillWarn: { backgroundColor: colors.accent },

  chapScroll: { marginHorizontal: -2 },
  chapCard: { width: 136, marginEnd: 16 },
  chapCardPressed: { opacity: 0.6 },
  chapCover: {
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  chapIcon: { width: 24, height: 24, tintColor: colors.textMuted },
  chapTitle: { fontSize: 12.5, color: colors.text, fontFamily: fonts.bold, marginBottom: 4, lineHeight: 17 },
  chapMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  chapMetaText: { fontSize: 10.5, color: colors.textFaint },

  watchTop: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  watchTitle: { fontSize: 13.5, color: colors.text, fontFamily: fonts.bold, marginBottom: 3 },
  watchMeta: { fontSize: 10.5, color: colors.textFaint },
  watchPercent: { fontSize: 22, color: colors.text, fontFamily: fonts.bold, marginStart: 10 },
  watchSummary: { fontSize: 11.5, color: colors.textFaint, marginTop: 10, textAlign: 'right', lineHeight: 17 },
  watchSummaryN: { color: colors.text, fontFamily: fonts.bold },

  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  soonText: { fontSize: 12, color: colors.textFaint, lineHeight: 19, textAlign: 'right' },

  gradesHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  exportButton: {
    marginTop: 26,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonPressed: { opacity: 0.75 },
  exportButtonText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12.5 },

  gradeChipsScroll: { marginTop: 12, marginBottom: 4 },
  gradeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginEnd: 8,
  },
  gradeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  gradeChipText: { fontSize: 11.5, color: colors.textMuted, fontFamily: fonts.medium },
  gradeChipTextActive: { color: colors.onPrimary, fontFamily: fonts.bold },

  gradesTableBlock: { marginBottom: 18 },
  gradesTableTitle: { fontSize: 12.5, color: colors.text, fontFamily: fonts.bold, marginBottom: 8, textAlign: 'right' },
  gradesRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  gradesRowAlt: { backgroundColor: colors.surface },
  gradesHeaderCell: {
    fontSize: 10,
    color: colors.textFaint,
    fontFamily: fonts.semiBold,
    paddingVertical: 8,
    paddingHorizontal: 6,
    textAlign: 'center',
  },
  gradesCell: {
    fontSize: 11.5,
    color: colors.textMuted,
    fontFamily: fonts.medium,
    paddingVertical: 9,
    paddingHorizontal: 6,
    textAlign: 'center',
  },
  gradesCellBold: { color: colors.text, fontFamily: fonts.bold },
  gradesScorePassed: { color: colors.success },
  gradesScoreFailed: { color: colors.danger },

  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  flagName: { fontSize: 13, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  flagMeta: { fontSize: 11, color: colors.textFaint, marginTop: 2, textAlign: 'right' },
  flagStatValue: { fontSize: 13, color: colors.accent, fontFamily: fonts.bold },
  flagStatLabel: { fontSize: 10.5, color: colors.textFaint, fontFamily: fonts.medium },
});
