import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, deleteSubject, myManagedCourses, myManagedSubjects } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { cardShadow, colors, fonts, gradientBrand, radius, spacing } from '@/constants/theme';
import type { ManagedCourse, Subject } from '@/lib/types';

export default function AdminHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  // Only ever populated for role=instructor — see the flat "chapters you
  // manage" list below, which replaces subject-browsing for them now that
  // their edit access is scoped to specific chapters (see
  // backend/app/models/teacher.py's user_id) rather than a whole subject.
  const [managedCourses, setManagedCourses] = useState<ManagedCourse[]>([]);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    if (isAdmin) {
      myManagedSubjects().then(setSubjects).catch(() => {});
    } else {
      myManagedCourses().then(setManagedCourses).catch(() => {});
    }
  }, [isAdmin]);

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
            {/* Gradient primary action (2026 redesign pass) — was two flat
                same-color rectangles; the gradient now marks which action is
                primary at a glance.
                Layout note: <Pressable> itself now owns the real size
                (flex:1 + minHeight — it's the row's direct flex child, so
                this is guaranteed to work, unlike flex:1 on something
                nested two levels down). <LinearGradient> is purely a visual
                fill absolutely stacked behind the label — it contributes
                nothing to sizing, so it can't come out the wrong size no
                matter what. The label is a plain sibling <Text>, not a
                child of <LinearGradient>, because on at least one device
                text rendered as a direct child of <LinearGradient> came out
                fully invisible even with an unmistakable color — a plain
                sibling stacked on top by ordinary z-order sidesteps that
                regardless of its actual cause. */}
            <Pressable
              onPress={() => router.push('/admin/create-subject')}
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            >
              <LinearGradient
                colors={gradientBrand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFillObject}
              />
              <Text style={styles.actionButtonText} pointerEvents="none">
                + New Subject
              </Text>
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

      <Text style={styles.sectionTitle}>{isAdmin ? 'All subjects' : 'Chapters you manage'}</Text>

      {isAdmin ? (
        <FlatList
          data={subjects}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable style={styles.cardMain} onPress={() => router.push(`/admin/subject/${item.id}`)}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardArrow}>›</Text>
              </Pressable>
              {/* Circular icon-only trash button (2026 redesign pass) instead
                  of a bare red "Delete" text link — same destructive confirm
                  Alert on press, just a clearer, more deliberate-looking tap
                  target for an irreversible action. */}
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                onPress={() => onDelete(item.id, item.name)}
                hitSlop={8}
              >
                <Text style={styles.deleteButtonIcon}>🗑️</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No subjects yet — create one above.</Text>}
        />
      ) : (
        // An instructor no longer browses by subject — their edit access is
        // scoped to specific chapters via their linked teacher card (see
        // backend/app/models/teacher.py's user_id), so this goes straight
        // into a chapter's own lecture/exam management screen.
        <FlatList
          data={managedCourses}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/admin/course/${item.id}`)}>
              <View style={styles.cardMain}>
                <View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardSubtitle}>{item.subject_name}</Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              You're not linked to a chapter yet — ask an admin to link your account to a teacher card.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  adminActions: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  actionButton: {
    // This is the Pressable itself — the row's direct flex child — so its
    // size is fully self-determined (flex:1 + minHeight) and never depends
    // on what's rendered inside it. See the JSX comment above.
    borderRadius: radius.pill,
    minHeight: 48,
    paddingHorizontal: 16,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionButtonPressed: { opacity: 0.85 },
  // Explicit fontSize/fontFamily here (rather than relying on RN's host
  // default + the app-wide Cairo default in app/_layout.tsx) — a Text with
  // its own `style` prop never picks up that global default in the first
  // place, and this button was the one place in the admin screens missing
  // an explicit size, so give it the same treatment every other button
  // label in the app already has. No positioning here — it's a normal
  // sibling centered by the Pressable's own alignItems/justifyContent.
  actionButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16, textAlign: 'center', fontFamily: fonts.bold },
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
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
