import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { PressableScale, ProgressRing, Skeleton, enterStagger, useCountUp } from '@/components/motion';
import { ResolvedImage } from '@/components/ResolvedImage';
import { listCourses, listProgress } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, fonts, gradientBrand, radius, spacing } from '@/constants/theme';
import type { Course, ProgressEntry } from '@/lib/types';

const STRINGS = {
  ar: {
    welcome: (name?: string) => `أهلاً بيك${name ? ` يا ${name.split(' ')[0]}` : ''}`,
    subtitle: 'يلا نكمّل من مكان ما وقفت',
    overall: 'التقدم الكلي',
    completed: 'دروس خلصتها',
    inProgress: 'دروس شغال فيها',
    chapters: 'فصول متاحة',
    continueLearning: 'كمّل التعلم',
    empty: 'مفيش كورسات لسه — تابعنا قريب.',
  },
  en: {
    welcome: (name?: string) => `Welcome back${name ? `, ${name.split(' ')[0]}` : ''}`,
    subtitle: 'Pick up right where you left off',
    overall: 'Overall',
    completed: 'Lessons done',
    inProgress: 'In progress',
    chapters: 'Chapters',
    continueLearning: 'Continue learning',
    empty: 'No courses yet — check back soon.',
  },
};

// A lesson counts as "done" from here up — the player marks progress in
// steps, so a fully-watched lesson can land a hair under 100.
const DONE_THRESHOLD = 90;

export default function HomeScreen() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const router = useRouter();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([listCourses(), listProgress()]);
    setCourses(c);
    setProgress(p);
  }, []);

  // Re-fetch every time this tab gains focus, not just on first mount —
  // otherwise content added elsewhere (e.g. a new course from the admin
  // screens) stays invisible here until the whole app is reloaded.
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        // Leave whatever was already shown; only drop the skeleton.
        setCourses((prev) => prev ?? []);
      });
    }, [load]),
  );

  const overallCompletion = progress.length
    ? Math.round(progress.reduce((sum, p) => sum + p.completion_percent, 0) / progress.length)
    : 0;
  const doneCount = progress.filter((p) => p.completion_percent >= DONE_THRESHOLD).length;
  const inProgressCount = progress.filter((p) => p.completion_percent > 0 && p.completion_percent < DONE_THRESHOLD).length;

  const header = (
    <View>
      <Animated.View entering={FadeInDown.duration(450)}>
        <Text style={styles.greeting}>{t.welcome(user?.full_name ?? undefined)}</Text>
        <Text style={styles.subtitle}>{t.subtitle}</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).springify().damping(16)} style={styles.hero}>
        <LinearGradient
          colors={[`${gradientBrand[0]}22`, `${gradientBrand[1]}10`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <ProgressRing percent={overallCompletion}>
          <RingLabel percent={overallCompletion} caption={t.overall} />
        </ProgressRing>
        <View style={styles.stats}>
          <Stat value={doneCount} label={t.completed} color={colors.success} />
          <Stat value={inProgressCount} label={t.inProgress} color={colors.accent} />
          <Stat value={courses?.length ?? 0} label={t.chapters} color={colors.primary} />
        </View>
      </Animated.View>

      <Animated.Text entering={FadeIn.delay(200)} style={styles.sectionTitle}>
        {t.continueLearning}
      </Animated.Text>
    </View>
  );

  if (courses === null) {
    return (
      <View style={styles.container}>
        <View style={styles.listContent}>
          <Skeleton style={{ height: 26, width: '60%', marginBottom: 8 }} />
          <Skeleton style={{ height: 14, width: '45%', marginBottom: spacing.xl }} />
          <Skeleton style={{ height: 124, borderRadius: radius.lg + 4, marginBottom: spacing.xl }} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 76, borderRadius: radius.lg, marginBottom: spacing.sm }} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load().catch(() => {});
              setRefreshing(false);
            }}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={enterStagger(index, 220)}>
            <PressableScale
              style={styles.courseCard}
              onPress={() => router.push(`/(tabs)/courses/${item.subject_id}/${item.id}`)}
            >
              <ResolvedImage
                url={item.cover_image_url}
                style={styles.thumb}
                containerStyle={styles.thumb}
                resizeMode="contain"
                fallback={
                  <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.thumb}>
                    <Text style={styles.thumbLetter}>{item.title.trim().charAt(0).toUpperCase()}</Text>
                  </LinearGradient>
                }
              />
              <View style={styles.courseBody}>
                <Text style={styles.courseTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.grade_level ? (
                  <View style={styles.gradePill}>
                    <Text style={styles.courseMeta}>{item.grade_level}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.chevron}>›</Text>
            </PressableScale>
          </Animated.View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t.empty}</Text>}
      />
    </View>
  );
}

function RingLabel({ percent, caption }: { percent: number; caption: string }) {
  const shown = useCountUp(percent, 1300);
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.ringValue}>{shown}%</Text>
      <Text style={styles.ringCaption}>{caption}</Text>
    </View>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  const shown = useCountUp(value);
  return (
    <View style={styles.stat}>
      <View style={[styles.statDot, { backgroundColor: color }]} />
      <Text style={styles.statValue}>{shown}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Bottom padding clears the floating tab bar (see AppTabBar).
  listContent: { padding: spacing.xl, paddingBottom: 120 },
  greeting: { fontSize: 24, fontFamily: fonts.bold, color: colors.text },
  subtitle: { color: colors.textMuted, marginTop: 2, fontFamily: fonts.regular },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radius.lg + 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: `${colors.violet}33`,
    overflow: 'hidden',
    ...cardShadow,
  },
  ringValue: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, lineHeight: 26 },
  ringCaption: { fontSize: 10, fontFamily: fonts.medium, color: colors.textMuted, lineHeight: 14 },
  stats: { flex: 1, gap: spacing.sm },
  stat: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  statValue: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, minWidth: 26 },
  statLabel: { flex: 1, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted },

  sectionTitle: { fontSize: 17, fontFamily: fonts.semiBold, marginBottom: spacing.md, color: colors.text },
  courseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    paddingRight: spacing.lg,
    marginBottom: spacing.sm,
    ...cardShadow,
  },
  // 16:9 — the same ratio the admin cover-crop tool exports.
  thumb: {
    width: 96,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbLetter: { color: colors.onPrimary, fontSize: 22, fontFamily: fonts.bold },
  courseBody: { flex: 1 },
  courseTitle: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text },
  gradePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '1F', // faint accent tint
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 4,
  },
  courseMeta: { color: colors.accent, fontSize: 11.5, fontFamily: fonts.semiBold },
  chevron: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
});
