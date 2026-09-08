import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listSubjects } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import type { Subject } from '@/lib/types';

const SUBJECT_ICONS: Record<string, string> = {
  Physics: '⚛️',
  Chemistry: '🧪',
  Biology: '🧬',
};

// Each subject gets its own two-stop gradient for its icon badge (2026
// redesign pass) instead of every subject sharing one flat gray square —
// gives the list a quick visual "fingerprint" per subject as you scan it.
// Falls back to the brand gradient for any subject name not listed here, so
// a newly-created subject never renders with an empty/undefined style.
const SUBJECT_GRADIENTS: Record<string, readonly [string, string]> = {
  Physics: [`${colors.primary}38`, `${colors.violet}38`],
  Chemistry: [`${colors.accent}38`, `${colors.accentDark}28`],
  Biology: [`${colors.success}38`, `${colors.primaryDark}24`],
};
const DEFAULT_GRADIENT: readonly [string, string] = [`${colors.primary}38`, `${colors.violet}38`];

const STRINGS = {
  ar: { empty: 'مفيش مواد متاحة لسه.' },
  en: { empty: 'No subjects published yet.' },
};

export default function SubjectsScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // useFocusEffect (not useEffect) so a subject added/edited elsewhere shows
  // up here as soon as you navigate back, without a full app reload.
  useFocusEffect(
    useCallback(() => {
      listSubjects().then(setSubjects).catch(() => {});
    }, []),
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={subjects}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push(`/(tabs)/courses/${item.id}`)}
          >
            <LinearGradient
              colors={SUBJECT_GRADIENTS[item.name] ?? DEFAULT_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconBadge}
            >
              <Text style={styles.icon}>{SUBJECT_ICONS[item.name] ?? '📘'}</Text>
            </LinearGradient>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t.empty}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg + 4,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...cardShadow,
  },
  cardPressed: { opacity: 0.85 },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  icon: { fontSize: 24 },
  title: { fontSize: 17, fontFamily: fonts.semiBold, color: colors.text, flex: 1 },
  chevron: { fontSize: 20, fontFamily: fonts.bold, color: colors.primary },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
});
