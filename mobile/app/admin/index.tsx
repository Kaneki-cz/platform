import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ApiError, deleteSubject, myManagedCourses, myManagedSubjects } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import { subjectIconSource } from '@/lib/subjectIcon';
import type { ManagedCourse, Subject } from '@/lib/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Redesign pass 2026-09 — replaces the earlier gradient "+ New Subject"
 * button, whose text repeatedly failed to render correctly on at least one
 * real device across several different structural attempts (LinearGradient
 * wrapping the label, the label as a sibling, various sizing strategies —
 * see git history on this file). Rather than keep chasing that, this
 * button (and every other tappable row on this screen) is now a plain
 * solid-color surface with a small scale-down animation on press instead —
 * simpler, and there's no gradient-rendering edge case left to hit. */
function Scalable({
  onPress,
  style,
  children,
  disabled,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 150 });
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

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
          <Scalable style={styles.actionButton} onPress={() => router.push('/admin/create-subject')}>
            <Text style={styles.actionButtonIcon}>＋</Text>
            <Text style={styles.actionButtonText}>New Subject</Text>
          </Scalable>

          <Scalable style={styles.utilityCard} onPress={() => router.push('/admin/users')}>
            <View style={styles.utilityIconWrap}>
              <Text style={styles.utilityIcon}>🎚️</Text>
            </View>
            <View style={styles.utilityTextWrap}>
              <Text style={styles.utilityTitle}>AI Question Limits</Text>
              <Text style={styles.utilitySubtitle}>Set daily limits & bonus questions</Text>
            </View>
            <Text style={styles.utilityArrow}>›</Text>
          </Scalable>

          <Scalable style={[styles.utilityCard, styles.utilityCardLast]} onPress={() => router.push('/admin/video-views')}>
            <View style={styles.utilityIconWrap}>
              <Text style={styles.utilityIcon}>🔒</Text>
            </View>
            <View style={styles.utilityTextWrap}>
              <Text style={styles.utilityTitle}>Video View Limits</Text>
              <Text style={styles.utilitySubtitle}>Fix up a student who hit a lecture's view limit</Text>
            </View>
            <Text style={styles.utilityArrow}>›</Text>
          </Scalable>
        </>
      ) : (
        // Instructor equivalent of the admin's "+ New Subject" button above —
        // lets them add a chapter of their own without an admin having to do
        // it for them first. The server assigns it to their own linked
        // teacher card automatically (see create-course.tsx and
        // backend/app/api/routes/courses.py's create_course), so there's no
        // subject/teacher picker here.
        <Scalable style={styles.actionButton} onPress={() => router.push('/admin/create-course')}>
          <Text style={styles.actionButtonIcon}>＋</Text>
          <Text style={styles.actionButtonText}>New Chapter</Text>
        </Scalable>
      )}

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{isAdmin ? 'All subjects' : 'Chapters you manage'}</Text>
        {isAdmin && subjects.length > 0 ? (
          <View style={styles.sectionCountBadge}>
            <Text style={styles.sectionCountText}>{subjects.length}</Text>
          </View>
        ) : null}
      </View>

      {isAdmin ? (
        <FlatList
          data={subjects}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Scalable style={styles.cardMain} onPress={() => router.push(`/admin/subject/${item.id}`)}>
                <View style={styles.cardMainLeft}>
                  <View style={styles.subjectIconWrap}>
                    <Image source={subjectIconSource(item.name)} style={styles.subjectIconImage} />
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </Scalable>
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
            <Scalable style={styles.card} onPress={() => router.push(`/admin/course/${item.id}`)}>
              <View style={styles.cardMain}>
                <View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardSubtitle}>{item.subject_name}</Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </View>
            </Scalable>
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
  // Solid color, not a gradient — see the note on <Scalable> above for why.
  // Still reads as the screen's primary action: full width, bright primary
  // color, bold label, plus the press-scale animation every row on this
  // screen now shares.
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginBottom: spacing.lg,
    // A colored glow instead of the plain black cardShadow every other row
    // uses — reads as the screen's one "lit up" element rather than just
    // another flat card, without going back to a gradient fill.
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  actionButtonIcon: { color: colors.onPrimary, fontSize: 18, fontWeight: '700', fontFamily: fonts.bold },
  actionButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16, fontFamily: fonts.bold },
  utilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '14',
    borderWidth: 1,
    borderColor: colors.accent + '33',
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: spacing.md,
    gap: spacing.md,
    ...cardShadow,
  },
  utilityCardLast: { marginBottom: spacing.xl },
  utilityIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityIcon: { fontSize: 22 },
  utilityTextWrap: { flex: 1 },
  utilityTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  utilitySubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  utilityArrow: { fontSize: 22, color: colors.accent, fontWeight: '600' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  sectionCountBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...cardShadow,
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardMainLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // No background tint here anymore — the Direction-B icon PNG already
  // bakes in its own colored radial-gradient badge circle.
  subjectIconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectIconImage: { width: 40, height: 40 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1 },
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
