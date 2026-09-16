import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { myDashboard } from '@/lib/api';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import { chapterTopicIcon, icons } from '@/lib/icons';
import type { DashboardChapter, ExamSpeedFlag, TeacherDashboard, VideoSkipFlag } from '@/lib/types';

// Same spirit as WEAK_SCORE_THRESHOLD below, but for the video-activity
// card — mirrors the backend's own VIDEO_COMPLETED_THRESHOLD /
// VIDEO_LOW_COMPLETION_THRESHOLD (app/api/routes/courses.py) purely for the
// progress-bar color cutoff below; the actual completed/low-completion
// COUNTS always come straight from the server, never recomputed here.
const VIDEO_COMPLETION_GOOD_THRESHOLD = 70;

// Cycles through the app's 4 brand colors in a fixed order — same spirit as
// admin/index.tsx's old SUBJECT_ACCENTS rotation — so the KPI row and the
// chapter cards read as distinct facts/items instead of one flat block of
// cyan. Never used to encode magnitude or status: the exam-performance
// section below still uses colors.accent alone for "needs attention",
// completely separate from this identity rotation.
const BRAND_CYCLE = [colors.primary, colors.violet, colors.accent, colors.success] as const;

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

  useFocusEffect(
    useCallback(() => {
      myDashboard().then(setData).catch(() => {});
    }, []),
  );

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
          <SectionLabel color={colors.primary} label="نظرة عامة" />
          <View style={styles.kpiGrid}>
            <KpiTile color={colors.primary} icon={icons.layers} label="الفصول" value={String(data.chapters_count)} />
            <KpiTile color={colors.violet} icon={icons.playCircle} label="المحاضرات" value={String(data.lectures_count)} />
            <KpiTile
              color={colors.accent}
              icon={icons.barChart}
              label="متوسط درجات الامتحانات"
              value={data.avg_score_percent != null ? `${Math.round(data.avg_score_percent)}%` : '—'}
            />
            <KpiTile
              color={colors.success}
              icon={icons.shieldCheck}
              label="نسبة النجاح"
              value={data.pass_rate_percent != null ? `${Math.round(data.pass_rate_percent)}%` : '—'}
            />
          </View>

          {perfRows.length > 0 ? (
            <>
              <SectionLabel color={colors.violet} label="أداء الطلاب حسب الفصل" />
              <View style={styles.perfCard}>
                {perfRows.map((c, index) => {
                  const isWeakest = c.id === weakestId;
                  const score = Math.round(c.avg_score_percent ?? 0);
                  return (
                    <View key={c.id} style={[styles.perfRow, index === perfRows.length - 1 && styles.perfRowLast]}>
                      <View style={styles.perfTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.perfName} numberOfLines={1}>
                            {c.title}
                          </Text>
                          <Text style={styles.perfMeta}>{c.exam_attempt_count} محاولة امتحان</Text>
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
                      {isWeakest ? (
                        <View style={styles.tag}>
                          <Image source={icons.warningTriangle} style={styles.tagIcon} />
                          <Text style={styles.tagText}>أضعف فصل — يحتاج مراجعة</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {data.exam_speed_flags.length > 0 ? (
            <>
              <SectionLabel color={colors.danger} label="امتحانات بسرعة مريبة" />
              <View style={styles.flagCard}>
                <Text style={styles.flagHint}>
                  متوسط الوقت لكل سؤال قليل جداً — مش بالضرورة غش، بس يستاهل نظرة.
                </Text>
                {data.exam_speed_flags.map((f, index) => (
                  <ExamSpeedFlagRow key={`${f.user_id}-${f.exam_title}-${index}`} flag={f} />
                ))}
              </View>
            </>
          ) : null}

          <SectionLabel color={colors.accent} label="الفصول" />
          <Text style={styles.chapHint}>اضغط على أي فصل عشان تشوف تقرير الطلاب بتاعه</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chapScroll}>
            {data.chapters.map((c, index) => (
              <ChapterCard
                key={c.id}
                chapter={c}
                color={BRAND_CYCLE[index % BRAND_CYCLE.length]}
                onPress={() => router.push(`/admin/course/${c.id}/report`)}
              />
            ))}
          </ScrollView>

          <SectionLabel color={colors.textFaint} label="نشاط المشاهدة" />
          {data.video_activity ? (
            <View style={styles.watchCard}>
              <View style={styles.watchTop}>
                <View style={styles.watchIconWrap}>
                  <Image source={icons.eye} style={styles.watchIcon} />
                </View>
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
                          ? colors.violet
                          : colors.accent,
                    },
                  ]}
                />
              </View>
              <View style={styles.watchChipsRow}>
                <View style={styles.watchChip}>
                  <Image source={icons.shieldCheck} style={[styles.watchChipIcon, { tintColor: colors.success }]} />
                  <Text style={styles.watchChipText}>
                    <Text style={styles.watchChipN}>{data.video_activity.completed_views_count}</Text> خلّصوا الفيديو
                    كامل
                  </Text>
                </View>
                <View style={styles.watchChip}>
                  <Image source={icons.warningTriangle} style={[styles.watchChipIcon, { tintColor: colors.accent }]} />
                  <Text style={styles.watchChipText}>
                    <Text style={styles.watchChipN}>{data.video_activity.low_completion_views_count}</Text> متخطيين
                    نص الفيديو
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.soonCard}>
              <View style={styles.soonTop}>
                <View style={styles.soonIconWrap}>
                  <Image source={icons.eye} style={styles.soonIcon} />
                </View>
                <Text style={styles.soonTitle}>لسه معندناش بيانات مشاهدة</Text>
              </View>
              <Text style={styles.soonDesc}>
                هتظهر هنا تلقائي أول ما الطلاب يبدأوا يتفرجوا على محاضرات الفيديو — هتوريك مين بيفوّت أجزاء ومين خلص
                الفيديو كامل.
              </Text>
            </View>
          )}

          {data.video_skip_flags.length > 0 ? (
            <>
              <SectionLabel color={colors.danger} label="طلاب بيتخطوا الفيديو" />
              <View style={styles.flagCard}>
                <Text style={styles.flagHint}>لقّطوا/سحبوا الفيديو للأمام أكتر من مرة بدل ما يتفرجوا عليه فعلاً.</Text>
                {data.video_skip_flags.map((f, index) => (
                  <VideoSkipFlagRow key={`${f.user_id}-${f.lesson_title}-${index}`} flag={f} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={[styles.sectionDot, { backgroundColor: color }]} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function KpiTile({
  color,
  icon,
  label,
  value,
}: {
  color: string;
  icon: ImageSourcePropType;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.kpi, { borderTopColor: color }]}>
      <View style={[styles.kpiIconWrap, { backgroundColor: color + '29' }]}>
        <Image source={icon} style={[styles.kpiIcon, { tintColor: color }]} />
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
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
      <View style={styles.flagStat}>
        <Text style={styles.flagStatValue}>{flag.seconds_per_question.toFixed(1)}s</Text>
        <Text style={styles.flagStatLabel}>لكل سؤال</Text>
      </View>
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
      <View style={styles.flagStat}>
        <Text style={styles.flagStatValue}>{flag.skip_count}×</Text>
        <Text style={styles.flagStatLabel}>{flag.skipped_seconds} ث اتخطت</Text>
      </View>
    </View>
  );
}

function ChapterCard({
  chapter,
  color,
  onPress,
}: {
  chapter: DashboardChapter;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.chapCard, pressed && styles.chapCardPressed]} onPress={onPress}>
      <View style={[styles.chapCover, { backgroundColor: color + '1f' }]}>
        <Image source={chapterTopicIcon(chapter.title)} style={[styles.chapIcon, { tintColor: color }]} />
      </View>
      <View style={styles.chapBody}>
        <Text style={styles.chapTitle} numberOfLines={2}>
          {chapter.title}
        </Text>
        <View style={styles.chapMeta}>
          <Text style={styles.chapMetaText}>
            <Text style={styles.chapMetaN}>{chapter.lecture_count}</Text> محاضرات
          </Text>
          <Text style={styles.chapMetaText}>
            {chapter.avg_score_percent != null ? `${Math.round(chapter.avg_score_percent)}%` : 'لسه من غير امتحانات'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  greetEyebrow: { fontSize: 12, color: colors.textFaint, fontFamily: fonts.medium, marginBottom: 3 },
  greetName: { fontSize: 19, color: colors.text, fontFamily: fonts.bold },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: spacing.md,
  },
  avatarText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 16 },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 22, marginBottom: 10 },
  sectionDot: { width: 6, height: 6, borderRadius: 2 },
  sectionLabel: { fontSize: 11, color: colors.textFaint, fontFamily: fonts.semiBold, letterSpacing: 0.5 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: {
    width: '48%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 2.5,
    borderRadius: radius.lg,
    padding: 14,
  },
  kpiIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  kpiIcon: { width: 14, height: 14 },
  kpiLabel: { fontSize: 11.5, color: colors.textMuted, fontFamily: fonts.medium, marginBottom: 6 },
  kpiValue: { fontSize: 24, color: colors.text, fontFamily: fonts.bold },

  perfCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    paddingBottom: 8,
  },
  perfRow: { marginBottom: 14 },
  perfRowLast: { marginBottom: 6 },
  perfTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  perfName: { fontSize: 13.5, color: colors.text, fontFamily: fonts.bold },
  perfMeta: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  perfScore: { fontSize: 14, color: colors.text, fontFamily: fonts.bold },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  fillWarn: { backgroundColor: colors.accent },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '26',
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
    marginTop: 7,
  },
  tagIcon: { width: 11, height: 11, tintColor: colors.accent },
  tagText: { fontSize: 10.5, color: colors.accent, fontFamily: fonts.bold },

  chapHint: { fontSize: 10.5, color: colors.textFaint, marginBottom: 8, textAlign: 'right' },
  chapScroll: { marginHorizontal: -2 },
  chapCard: {
    width: 150,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginEnd: 10,
  },
  chapCardPressed: { opacity: 0.85 },
  chapCover: { height: 78, alignItems: 'center', justifyContent: 'center' },
  chapIcon: { width: 28, height: 28 },
  chapBody: { padding: 11 },
  chapTitle: { fontSize: 12.5, color: colors.text, fontFamily: fonts.bold, marginBottom: 6, lineHeight: 17 },
  chapMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  chapMetaText: { fontSize: 10.5, color: colors.textMuted },
  chapMetaN: { color: colors.text, fontFamily: fonts.bold },

  soonCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.violet + '52',
    borderRadius: radius.lg,
    padding: 16,
    backgroundColor: colors.violet + '0a',
  },
  soonTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  soonIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soonIcon: { width: 17, height: 17, tintColor: colors.textMuted },
  soonTitle: { flex: 1, fontSize: 13.5, color: colors.text, fontFamily: fonts.bold },
  soonDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 19 },

  watchCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
  },
  watchTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  watchIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.violet + '1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchIcon: { width: 17, height: 17, tintColor: colors.violet },
  watchTitle: { fontSize: 13.5, color: colors.text, fontFamily: fonts.bold, marginBottom: 2 },
  watchMeta: { fontSize: 10.5, color: colors.textFaint },
  watchPercent: { fontSize: 20, color: colors.violet, fontFamily: fonts.bold },
  watchChipsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  watchChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  watchChipIcon: { width: 13, height: 13 },
  watchChipText: { flex: 1, fontSize: 10.5, color: colors.textMuted, lineHeight: 14 },
  watchChipN: { color: colors.text, fontFamily: fonts.bold },

  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, lineHeight: 20 },

  flagCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger + '33',
    borderRadius: radius.lg,
    padding: 14,
  },
  flagHint: { fontSize: 11, color: colors.textFaint, lineHeight: 16, marginBottom: 10, textAlign: 'right' },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  flagName: { fontSize: 13, color: colors.text, fontFamily: fonts.bold, textAlign: 'right' },
  flagMeta: { fontSize: 11, color: colors.textFaint, marginTop: 2, textAlign: 'right' },
  flagStat: { alignItems: 'flex-end' },
  flagStatValue: { fontSize: 14, color: colors.danger, fontFamily: fonts.bold },
  flagStatLabel: { fontSize: 10, color: colors.textFaint, marginTop: 1 },
});
