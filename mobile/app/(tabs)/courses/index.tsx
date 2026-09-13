import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { listSubjects } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import { subjectIconSource } from '@/lib/subjectIcon';
import type { Subject } from '@/lib/types';

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
            <View style={styles.iconBadge}>
              <Image source={subjectIconSource(item.name)} style={styles.icon} />
            </View>
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
  // No gradient wrapper here anymore — the Direction-B icon PNG already
  // bakes in its own colored radial-gradient badge circle.
  iconBadge: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  icon: { width: 52, height: 52 },
  title: { fontSize: 17, fontFamily: fonts.semiBold, color: colors.text, flex: 1 },
  chevron: { fontSize: 20, fontFamily: fonts.bold, color: colors.primary },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
});
