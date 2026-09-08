import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, deleteSubject, myManagedSubjects } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { cardShadow, colors, gradientBrand, radius, spacing } from '@/constants/theme';
import type { Subject } from '@/lib/types';

export default function AdminHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    myManagedSubjects().then(setSubjects).catch(() => {});
  }, []);

  useFocusEffect(load);

  const onDelete = (subjectId: string, name: string) => {
    Alert.alert(
      'Delete subject?',
      `This will permanently delete "${name}" and every chapter and lecture inside it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSubject(subjectId);
              load();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      {isAdmin ? (
        <>
          <View style={styles.adminActions}>
            {/* Gradient primary action + bordered pill secondary action
                (2026 redesign pass) — was two flat same-color rectangles;
                the gradient now marks which action is primary at a glance. */}
            <Pressable onPress={() => router.push('/admin/create-subject')}>
              {({ pressed }) => (
                <LinearGradient
                  colors={gradientBrand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.actionButton, pressed && styles.actionButtonPressed]}
                >
                  <Text style={styles.actionButtonText}>+ New Subject</Text>
                </LinearGradient>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
              onPress={() => router.push('/admin/instructors')}
            >
              <Text style={styles.secondaryButtonText}>Manage Instructors</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [styles.aiLimitsCard, pressed && styles.aiLimitsCardPressed]}
            onPress={() => router.push('/admin/users')}
          >
            <View style={styles.aiLimitsIconWrap}>
              <Text style={styles.aiLimitsIcon}>🎚️</Text>
            </View>
            <View style={styles.aiLimitsTextWrap}>
              <Text style={styles.aiLimitsTitle}>AI Question Limits</Text>
              <Text style={styles.aiLimitsSubtitle}>Set daily limits & bonus questions</Text>
            </View>
            <Text style={styles.aiLimitsArrow}>›</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.aiLimitsCard, pressed && styles.aiLimitsCardPressed]}
            onPress={() => router.push('/admin/video-views')}
          >
            <View style={styles.aiLimitsIconWrap}>
              <Text style={styles.aiLimitsIcon}>🔒</Text>
            </View>
            <View style={styles.aiLimitsTextWrap}>
              <Text style={styles.aiLimitsTitle}>Video View Limits</Text>
              <Text style={styles.aiLimitsSubtitle}>Fix up a student who hit a lecture's view limit</Text>
            </View>
            <Text style={styles.aiLimitsArrow}>›</Text>
          </Pressable>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>
        {isAdmin ? 'All subjects' : 'Subjects you manage'}
      </Text>

      <FlatList
        data={subjects}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable style={styles.cardMain} onPress={() => router.push(`/admin/subject/${item.id}`)}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardArrow}>›</Text>
            </Pressable>
            {isAdmin ? (
              // Circular icon-only trash button (2026 redesign pass) instead
              // of a bare red "Delete" text link — same destructive confirm
              // Alert on press, just a clearer, more deliberate-looking tap
              // target for an irreversible action.
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                onPress={() => onDelete(item.id, item.name)}
                hitSlop={8}
              >
                <Text style={styles.deleteButtonIcon}>🗑️</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isAdmin
              ? 'No subjects yet — create one above.'
              : "You're not assigned as an instructor to any subject yet. Ask an admin to assign you."}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  adminActions: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  actionButton: {
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: { opacity: 0.85 },
  actionButtonText: { color: colors.onPrimary, fontWeight: '600', textAlign: 'center' },
  secondaryButton: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    backgroundColor: colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonPressed: { backgroundColor: colors.primary + '22' },
  secondaryButtonText: { color: colors.primary, fontWeight: '600', textAlign: 'center' },
  aiLimitsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '14',
    borderWidth: 1,
    borderColor: colors.accent + '33',
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: spacing.xl,
    gap: spacing.md,
    ...cardShadow,
  },
  aiLimitsCardPressed: { backgroundColor: colors.accent + '22' },
  aiLimitsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiLimitsIcon: { fontSize: 22 },
  aiLimitsTextWrap: { flex: 1 },
  aiLimitsTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  aiLimitsSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  aiLimitsArrow: { fontSize: 22, color: colors.accent, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...cardShadow,
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  cardArrow: { fontSize: 20, color: colors.textFaint, marginRight: 12 },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.danger + '55',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  deleteButtonPressed: { opacity: 0.75 },
  deleteButtonIcon: { fontSize: 15 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
