import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, grantBonusViews, listAllUsers, listUserLessonViews, resetLessonViews } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { LessonViewInfo, User } from '@/lib/types';

/**
 * Admin-only: fixes up a student who got blocked from rewatching a lecture
 * by its per-lecture view limit (see Lesson.max_views, set from the
 * "Lectures" screen's lecture form) — most often after an accidental
 * reload burned a view they didn't mean to spend.
 *
 * Two-step flow: search for the student by name/email, then pick which
 * capped lecture to fix from the list of lectures they've actually opened
 * (uncapped lectures never show up here — there's nothing to manage on
 * them). Per lecture, either reset their used-view count back to 0, or
 * grant some extra views on top of the lecture's normal limit.
 */
export default function VideoViewLimitsScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [views, setViews] = useState<LessonViewInfo[]>([]);
  const [loadingViews, setLoadingViews] = useState(false);
  const [bonusEditingLessonId, setBonusEditingLessonId] = useState<string | null>(null);
  const [bonusValue, setBonusValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listAllUsers().then(setUsers).catch(() => {});
    }, []),
  );

  const loadViews = useCallback((userId: string) => {
    setLoadingViews(true);
    listUserLessonViews(userId)
      .then(setViews)
      .catch(() => setError('Could not load this student’s view history.'))
      .finally(() => setLoadingViews(false));
  }, []);

  const selectUser = (user: User) => {
    setError(null);
    setSelectedUser(user);
    setBonusEditingLessonId(null);
    loadViews(user.id);
  };

  const backToSearch = () => {
    setSelectedUser(null);
    setViews([]);
    setError(null);
    setBonusEditingLessonId(null);
  };

  const onReset = async (lessonId: string) => {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await resetLessonViews(selectedUser.id, lessonId);
      setViews((prev) => prev.map((v) => (v.lesson_id === lessonId ? updated : v)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const startBonus = (lessonId: string) => {
    setError(null);
    setBonusEditingLessonId(lessonId);
    setBonusValue('');
  };

  const cancelBonus = () => {
    setBonusEditingLessonId(null);
    setBonusValue('');
    setError(null);
  };

  const giveBonus = async (lessonId: string) => {
    if (!selectedUser) return;
    const parsed = Number(bonusValue.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('Enter a whole number greater than 0.');
      return;
    }
    setSaving(true);
    try {
      const updated = await grantBonusViews(selectedUser.id, lessonId, parsed);
      setViews((prev) => prev.map((v) => (v.lesson_id === lessonId ? updated : v)));
      cancelBonus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.email.toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q);
  });

  if (!selectedUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>
          Search for a student to see the capped lectures they've opened, and fix up their view count if they hit
          the limit by mistake (e.g. an accidental reload).
        </Text>
        <TextInput
          style={styles.search}
          placeholder="Search by name or email..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <FlatList
          data={filteredUsers}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => selectUser(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.full_name || item.email}</Text>
                <Text style={styles.email}>{item.email}</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No accounts match that search.</Text>}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={backToSearch} style={styles.backRow}>
        <Text style={styles.backText}>‹ Back to search</Text>
      </Pressable>
      <Text style={styles.studentName}>{selectedUser.full_name || selectedUser.email}</Text>
      <Text style={styles.email}>{selectedUser.email}</Text>

      {loadingViews ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
      ) : (
        <FlatList
          data={views}
          keyExtractor={(v) => v.lesson_id}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => {
            const isEditingBonus = bonusEditingLessonId === item.lesson_id;
            return (
              <View style={styles.card}>
                <View style={styles.cardMain}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.lesson_title}</Text>
                    <Text style={styles.email}>{item.course_title}</Text>
                  </View>
                  <View style={styles.limitBlock}>
                    <Text style={styles.limitValue}>
                      {item.view_count}/{item.views_allowed}
                    </Text>
                    {item.bonus_views > 0 ? <Text style={styles.bonusTag}>+{item.bonus_views} bonus</Text> : null}
                    {item.view_limit_reached ? <Text style={styles.blockedTag}>blocked</Text> : null}
                  </View>
                </View>

                {isEditingBonus ? (
                  <View style={styles.editRow}>
                    <TextInput
                      style={styles.editInput}
                      keyboardType="number-pad"
                      placeholder="+2"
                      placeholderTextColor="#9ca3af"
                      value={bonusValue}
                      onChangeText={setBonusValue}
                      autoFocus
                    />
                    <Pressable
                      style={styles.saveButton}
                      onPress={() => giveBonus(item.lesson_id)}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator color={colors.onPrimary} />
                      ) : (
                        <Text style={styles.saveButtonText}>Grant</Text>
                      )}
                    </Pressable>
                    <Pressable onPress={cancelBonus} disabled={saving}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Pressable onPress={() => startBonus(item.lesson_id)} disabled={saving}>
                      <Text style={styles.bonusText}>Grant extra views</Text>
                    </Pressable>
                    <Pressable onPress={() => onReset(item.lesson_id)} disabled={saving}>
                      <Text style={styles.resetText}>Reset to 0</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              This student hasn't opened any view-limited lecture yet — nothing to manage.
            </Text>
          }
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: spacing.md, lineHeight: 17 },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 15,
    marginBottom: spacing.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  backRow: { marginBottom: spacing.sm },
  backText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  studentName: { fontSize: 18, fontWeight: '700', color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardArrow: { fontSize: 20, color: colors.textFaint },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  email: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  limitBlock: { alignItems: 'flex-end' },
  limitValue: { fontSize: 15, fontWeight: '700', color: colors.primary },
  bonusTag: { fontSize: 10, fontWeight: '700', color: colors.success, marginTop: 4 },
  blockedTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  actionRow: { flexDirection: 'row', gap: 16, marginTop: spacing.sm, flexWrap: 'wrap' },
  bonusText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  resetText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, flexWrap: 'wrap' },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 80,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 8 },
  saveButtonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 13 },
  cancelText: { color: colors.textFaint, fontSize: 13 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 8, marginBottom: 8 },
});
