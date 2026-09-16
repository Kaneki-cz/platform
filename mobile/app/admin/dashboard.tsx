import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { getGradesMatrix, myDashboard } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { chapterTopicIcon } from '@/lib/icons';
import type {
  DashboardChapter,
  ExamSpeedFlag,
  GradesMatrixData,
  StudentExamGradeRow,
  TeacherDashboard,
  VideoSkipFlag,
} from '@/lib/types';

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

  useFocusEffect(
    useCallback(() => {
      myDashboard().then(setData).catch(() => {});
      getGradesMatrix().then(setGradesMatrix).catch(() => {});
    }, []),
  );

  // One group per chapter, in the order its rows first appear (the backend
  // already orders rows by chapter) — each group renders as its own small
  // table (see GradesTable) instead of one giant table mixing every
  // chapter's exams together.
  const gradesByChapter = useMemo(() => {
    const groups: { courseId: string; courseTitle: string; rows: StudentExamGradeRow[] }[] = [];
    const indexByCourseId = new Map<string, number>();
    for (const row of gradesMatrix?.rows ?? []) {
      let idx = indexByCourseId.get(row.course_id);
      if (idx === undefined) {
        idx = groups.length;
        indexByCourseId.set(row.course_id, idx);
        groups.push({ courseId: row.course_id, courseTitle: row.course_title, rows: [] });
      }
      groups[idx].rows.push(row);
    }
    return groups;
  }, [gradesMatrix]);

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

          {gradesByChapter.length > 0 ? (
            <>
              <SectionLabel label="درجات الطلاب في الامتحانات" />
              <Text style={styles.hint}>
                درجة كل طالب في كل امتحان، ومتوسطه على آخر 30 يوم ومتوسطه في الفصل ده كامل.
              </Text>
              {gradesByChapter.map((group) => (
                <GradesTable key={group.courseId} courseTitle={group.courseTitle} rows={group.rows} />
              ))}
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
            <Text style={[styles.gradesHeaderCell, gradesCols.exam]}>الامتحان</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.score]}>الدرجة</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.avg]}>متوسط الشهر</Text>
            <Text style={[styles.gradesHeaderCell, gradesCols.avg]}>متوسط الفصل</Text>
          </View>
          {rows.map((r, i) => (
            <View key={`${r.exam_id}-${r.user_id}-${i}`} style={[styles.gradesRow, i % 2 === 1 && styles.gradesRowAlt]}>
              <Text style={[styles.gradesCell, gradesCols.name, styles.gradesCellBold]} numberOfLines={1}>
                {r.full_name?.trim() || r.email}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.code]}>{r.student_code ?? '—'}</Text>
              <Text style={[styles.gradesCell, gradesCols.exam]} numberOfLines={1}>
                {r.exam_title}
              </Text>
              <Text style={[styles.gradesCell, gradesCols.score, styles.gradesCellBold]}>
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
