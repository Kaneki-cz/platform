import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { listCourses, listProgress } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, radius, spacing } from '@/constants/theme';
import type { Course, ProgressEntry } from '@/lib/types';

const STRINGS = {
  ar: {
    welcome: (name?: string) => `أهلاً بيك${name ? ` يا ${name}` : ''} 👋`,
    overallProgress: (percent: number) => `التقدم الكلي: ${percent}%`,
    continueLearning: 'كمّل التعلم',
    empty: 'مفيش كورسات لسه — تابعنا قريب.',
  },
  en: {
    welcome: (name?: string) => `Welcome back${name ? `, ${name}` : ''} 👋`,
    overallProgress: (percent: number) => `Overall progress: ${percent}%`,
    continueLearning: 'Continue learning',
    empty: 'No courses yet — check back soon.',
  },
};

export default function HomeScreen() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
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
        /* TODO: surface a toast/banner on failure */
      });
    }, [load]),
  );

  const overallCompletion = progress.length
    ? Math.round(progress.reduce((sum, p) => sum + p.completion_percent, 0) / progress.length)
    : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>{t.welcome(user?.full_name)}</Text>
      <Text style={styles.progressText}>{t.overallProgress(overallCompletion)}</Text>

      <Text style={styles.sectionTitle}>{t.continueLearning}</Text>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.courseCard, pressed && styles.courseCardPressed]}
            onPress={() => router.push(`/(tabs)/courses/${item.subject_id}/${item.id}`)}
          >
            <Text style={styles.courseTitle}>{item.title}</Text>
            {item.grade_level ? (
              <View style={styles.gradePill}>
                <Text style={styles.courseMeta}>{item.grade_level}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t.empty}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.text },
  progressText: { color: colors.textMuted, marginTop: 4, marginBottom: spacing.xl },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: spacing.md, color: colors.text },
  courseCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...cardShadow,
  },
  courseCardPressed: { opacity: 0.85 },
  courseTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  gradePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '1F', // faint accent tint
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.sm,
  },
  courseMeta: { color: colors.accentDark, fontSize: 12, fontWeight: '600' },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
});
