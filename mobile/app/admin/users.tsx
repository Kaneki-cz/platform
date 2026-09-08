import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, grantAiBonusQuestions, listAllUsers, setUserAiLimit } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { User } from '@/lib/types';

/**
 * Admin-only: shows every account's AI-assistant daily question limit and
 * lets the admin control two SEPARATE things:
 *
 *  1. The recurring daily limit (`ai_daily_limit_override`) — replaces the
 *     plan's free/pro default every day, until changed again.
 *  2. A one-time bonus for TODAY only (`ai_bonus_questions_today`) — e.g. a
 *     student ran out and asked for a few more, without touching their
 *     permanent daily limit.
 *
 * Admin-role accounts are ALWAYS unlimited (see User.effective_ai_daily_limit
 * on the backend) — this is automatic and not something anyone configures,
 * so admin rows here show "Unlimited (admin)" with no edit controls at all.
 */
export default function AiLimitsScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [bonusEditingId, setBonusEditingId] = useState<string | null>(null);
  const [bonusValue, setBonusValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAllUsers().then(setUsers).catch(() => {});
  }, []);

  useFocusEffect(load);

  const startEdit = (user: User) => {
    setError(null);
    setBonusEditingId(null);
    setEditingId(user.id);
    // effective_ai_daily_limit is null for admin rows, but the "Edit limit"
    // control is hidden entirely for those (see renderItem) so this only
    // ever runs for a student/instructor row, where it's always a number.
    setEditValue(user.effective_ai_daily_limit !== null ? String(user.effective_ai_daily_limit) : '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
    setError(null);
  };

  const save = async (userId: string) => {
    const parsed = Number(editValue.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError('Enter a whole number, 0 or greater.');
      return;
    }
    setSaving(true);
    try {
      const updated = await setUserAiLimit(userId, parsed);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      cancelEdit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const useDefault = async (userId: string) => {
    setSaving(true);
    try {
      const updated = await setUserAiLimit(userId, null);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      cancelEdit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const startBonus = (user: User) => {
    setError(null);
    setEditingId(null);
    setBonusEditingId(user.id);
    setBonusValue('');
  };

  const cancelBonus = () => {
    setBonusEditingId(null);
    setBonusValue('');
    setError(null);
  };

  const giveBonus = async (userId: string) => {
    const parsed = Number(bonusValue.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('Enter a whole number greater than 0.');
      return;
    }
    setSaving(true);
    try {
      const updated = await grantAiBonusQuestions(userId, parsed);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      cancelBonus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.email.toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q);
  });

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search by name or email..."
        placeholderTextColor="#9ca3af"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />

      <FlatList
        data={filtered}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => {
          const isAdmin = item.role === 'admin';
          const isEditing = editingId === item.id;
          const isEditingBonus = bonusEditingId === item.id;
          const isCustom = item.ai_daily_limit_override !== null;
          const hasBonusToday = item.ai_bonus_questions_today > 0;

          return (
            <View style={styles.card}>
              <View style={styles.cardMain}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.full_name || item.email}</Text>
                  <Text style={styles.email}>{item.email}</Text>
                  <Text style={styles.meta}>
                    {item.plan} · {item.role}
                  </Text>
                </View>
                <View style={styles.limitBlock}>
                  <Text style={styles.limitValue}>
                    {isAdmin ? 'Unlimited' : `${item.effective_ai_daily_limit}/day`}
                  </Text>
                  {isAdmin ? <Text style={styles.adminTag}>admin</Text> : null}
                  {!isAdmin && isCustom ? <Text style={styles.customTag}>custom</Text> : null}
                  {!isAdmin && hasBonusToday ? (
                    <Text style={styles.bonusTag}>🎁 +{item.ai_bonus_questions_today} today</Text>
                  ) : null}
                </View>
              </View>

              {isAdmin ? (
                // Admins are always unlimited — nothing here to edit or grant.
                <Text style={styles.adminNote}>Admins always have unlimited questions.</Text>
              ) : (
                <>
                  {isEditing ? (
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        keyboardType="number-pad"
                        value={editValue}
                        onChangeText={setEditValue}
                        autoFocus
                      />
                      <Pressable style={styles.saveButton} onPress={() => save(item.id)} disabled={saving}>
                        {saving ? (
                          <ActivityIndicator color={colors.onPrimary} />
                        ) : (
                          <Text style={styles.saveButtonText}>Save</Text>
                        )}
                      </Pressable>
                      <Pressable style={styles.defaultButton} onPress={() => useDefault(item.id)} disabled={saving}>
                        <Text style={styles.defaultButtonText}>Use default</Text>
                      </Pressable>
                      <Pressable onPress={cancelEdit} disabled={saving}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : isEditingBonus ? (
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        keyboardType="number-pad"
                        placeholder="+5"
                        placeholderTextColor="#9ca3af"
                        value={bonusValue}
                        onChangeText={setBonusValue}
                        autoFocus
                      />
                      <Pressable style={styles.saveButton} onPress={() => giveBonus(item.id)} disabled={saving}>
                        {saving ? (
                          <ActivityIndicator color={colors.onPrimary} />
                        ) : (
                          <Text style={styles.saveButtonText}>Give bonus</Text>
                        )}
                      </Pressable>
                      <Pressable onPress={cancelBonus} disabled={saving}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <Pressable onPress={() => startEdit(item)}>
                        <Text style={styles.editText}>Edit daily limit</Text>
                      </Pressable>
                      <Pressable onPress={() => startBonus(item)}>
                        <Text style={styles.bonusText}>Give bonus questions today</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No accounts match that search.</Text>}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  email: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textFaint, marginTop: 2, textTransform: 'capitalize' },
  limitBlock: { alignItems: 'flex-end' },
  limitValue: { fontSize: 15, fontWeight: '700', color: colors.primary },
  adminTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onPrimary,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  customTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentDark,
    backgroundColor: colors.accent + '1F',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  bonusTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
    marginTop: 4,
  },
  adminNote: { color: colors.textFaint, fontSize: 12, marginTop: spacing.sm, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 16, marginTop: spacing.sm, flexWrap: 'wrap' },
  editText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  bonusText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
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
  defaultButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  defaultButtonText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  cancelText: { color: colors.textFaint, fontSize: 13 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 8, marginBottom: 8 },
});
