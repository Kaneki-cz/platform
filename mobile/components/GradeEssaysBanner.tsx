import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts, radius, spacing } from '@/constants/theme';

/** "N essay answers to grade" — shown on every teacher screen for an exam
 * (exam list card, questions, attempts, analytics) so the grading screen is
 * one tap away wherever the teacher happens to be. Renders nothing at 0. */
export function GradeEssaysBanner({ examId, count, style }: { examId: string; count: number | null | undefined; style?: object }) {
  const router = useRouter();
  if (!count) return null;
  return (
    <Animated.View entering={FadeInDown.duration(250)}>
      <Pressable
        style={[styles.banner, style]}
        onPress={() => router.push(`/admin/exam/${examId}/review`)}
        accessibilityRole="button"
        accessibilityLabel={`Grade ${count} essay answer${count === 1 ? '' : 's'}`}
      >
        <Ionicons name="create-outline" size={18} color={colors.accent} />
        <Text style={styles.text}>
          {count} essay answer{count === 1 ? '' : 's'} to grade
        </Text>
        <Text style={styles.cta}>Grade now</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.accent} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent + '66',
    backgroundColor: colors.accent + '14',
    minHeight: 48,
  },
  text: { flex: 1, color: colors.text, fontFamily: fonts.semiBold, fontSize: 13.5 },
  cta: { color: colors.accent, fontFamily: fonts.bold, fontSize: 13 },
});
