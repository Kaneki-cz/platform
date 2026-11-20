import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale, Skeleton, enterStagger } from '@/components/motion';

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
  const [subjects, setSubjects] = useState<Subject[] | null>(null);

  // useFocusEffect (not useEffect) so a subject added/edited elsewhere shows
  // up here as soon as you navigate back, without a full app reload.
  useFocusEffect(
    useCallback(() => {
      listSubjects().then(setSubjects).catch(() => {});
    }, []),
  );

  return (
    <View style={styles.container}>
      {subjects === null ? (
        <View style={{ padding: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
      <FlatList
        data={subjects}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item, index }) => (
          <Animated.View entering={enterStagger(index)}>
          <PressableScale style={styles.card} onPress={() => router.push(`/(tabs)/courses/${item.id}`)}>
            <View style={styles.iconBadge}>
              <Image source={subjectIconSource(item.name)} style={styles.icon} />
            </View>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.chevron}>›</Text>
          </PressableScale>
          </Animated.View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t.empty}</Text>}
      />
      )}
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
  skeletonCard: { height: 84, borderRadius: radius.lg + 4, marginBottom: spacing.md },
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
