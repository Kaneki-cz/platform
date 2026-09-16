import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ApiError,
  adminGetUserEnrollments,
  adminUpdateUserEnrollment,
  listAllUsers,
  listTeacherGroups,
} from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { TeacherGroup, User } from '@/lib/types';

interface AdminEnrollment {
  teacher_id: string;
  teacher_name: string | null;
  group_id: string | null;
  group_name: string | null;
}

/**
 * Admin-only: view every student's per-teacher enrollment (full name/grade
 * they submitted, which group they're in) and reassign their group.
 *
 * Enrollments are loaded lazily per student (on first expand) and cached in
 * `enrollmentsByUser`; a teacher's group list is likewise loaded lazily (on
 * first "Change group" tap) and cached in `groupsByTeacher` — a student
 * enrolled with several teachers would otherwise mean several redundant
 * fetches every time the list re-renders.
 */
export default function AdminStudentsScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [enrollmentsByUser, setEnrollmentsByUser] = useState<Record<string, AdminEnrollment[]>>({});
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const [groupsByTeacher, setGroupsByTeacher] = useState<Record<string, TeacherGroup[]>>({});
  const [pickerTeacherId, setPickerTeacherId] = useState<string | null>(null);
  const [savingTeacherId, setSavingTeacherId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAllUsers().then(setUsers).catch(() => {});
  }, []);

  useFocusEffect(load);

  const toggleExpand = async (user: User) => {
    setError(null);
    setPickerTeacherId(null);
    if (expandedUserId === user.id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(user.id);
    if (enrollmentsByUser[user.id]) return; // already cached
    setLoadingUserId(user.id);
    try {
      const rows = await adminGetUserEnrollments(user.id);
      setEnrollmentsByUser((prev) => ({ ...prev, [user.id]: rows }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load enrollments.');
    } finally {
      setLoadingUserId(null);
    }
  };

  const openGroupPicker = async (teacherId: string) => {
    setError(null);
    if (pickerTeacherId === teacherId) {
      setPickerTeacherId(null);
      return;
    }
    setPickerTeacherId(teacherId);
    if (groupsByTeacher[teacherId]) return; // already cached
    try {
      const groups = await listTeacherGroups(teacherId);
      setGroupsByTeacher((prev) => ({ ...prev, [teacherId]: groups }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load groups.');
    }
  };

  const chooseGroup = async (userId: string, teacherId: string, groupId: string | null) => {
    setError(null);
    setSavingTeacherId(teacherId);
    try {
      await adminUpdateUserEnrollment(userId, teacherId, groupId);
      setEnrollmentsByUser((prev) => {
        const rows = prev[userId] ?? [];
        const groups = groupsByTeacher[teacherId] ?? [];
        const groupName = groupId ? groups.find((g) => g.id === groupId)?.name ?? null : null;
        return {
          ...prev,
          [userId]: rows.map((r) => (r.teacher_id === teacherId ? { ...r, group_id: groupId, group_name: groupName } : r)),
        };
      });
      setPickerTeacherId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update group.');
    } finally {
      setSavingTeacherId(null);
    }
  };

  const students = users.filter((u) => u.role === 'student');
  const filtered = students.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.full_name ?? '').toLowerCase().includes(q) ||
      (u.full_name_ar ?? '').toLowerCase().includes(q)
    );
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
          const isExpanded = expandedUserId === item.id;
          const isLoading = loadingUserId === item.id;
          const enrollments = enrollmentsByUser[item.id] ?? [];

          return (
            <View style={styles.card}>
              <Pressable style={styles.cardMain} onPress={() => toggleExpand(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.full_name || item.email}</Text>
                  {item.full_name_ar ? <Text style={styles.nameAr}>{item.full_name_ar}</Text> : null}
                  <Text style={styles.email}>{item.email}</Text>
                  {item.grade ? <Text style={styles.meta}>{item.grade}</Text> : null}
                </View>
                <Text style={styles.arrow}>{isExpanded ? '▾' : '▸'}</Text>
              </Pressable>

              {isExpanded ? (
                <View style={styles.expandArea}>
                  {isLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
                  ) : enrollments.length === 0 ? (
                    <Text style={styles.empty}>Not enrolled with any teacher yet.</Text>
                  ) : (
                    enrollments.map((en) => {
                      const isPickerOpen = pickerTeacherId === en.teacher_id;
                      const groups = groupsByTeacher[en.teacher_id] ?? [];
                      const isSaving = savingTeacherId === en.teacher_id;
                      return (
                        <View key={en.teacher_id} style={styles.enrollmentRow}>
                          <View style={styles.enrollmentMain}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.teacherName}>{en.teacher_name ?? 'Unknown teacher'}</Text>
                              <Text style={styles.groupText}>{en.group_name ?? 'No group'}</Text>
                            </View>
                            <Pressable onPress={() => openGroupPicker(en.teacher_id)} disabled={isSaving}>
                              {isSaving ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                              ) : (
                                <Text style={styles.changeText}>{isPickerOpen ? 'Close' : 'Change group'}</Text>
                              )}
                            </Pressable>
                          </View>

                          {isPickerOpen ? (
                            <View style={styles.chipRow}>
                              <Pressable
                                style={[styles.chip, en.group_id === null && styles.chipSelected]}
                                onPress={() => chooseGroup(item.id, en.teacher_id, null)}
                              >
                                <Text style={[styles.chipText, en.group_id === null && styles.chipTextSelected]}>No group</Text>
                              </Pressable>
                              {groups.map((g) => (
                                <Pressable
                                  key={g.id}
                                  style={[styles.chip, en.group_id === g.id && styles.chipSelected]}
                                  onPress={() => chooseGroup(item.id, en.teacher_id, g.id)}
                                >
                                  <Text style={[styles.chipText, en.group_id === g.id && styles.chipTextSelected]}>{g.name}</Text>
                                </Pressable>
                              ))}
                              {groups.length === 0 ? <Text style={styles.hint}>This teacher has no groups yet.</Text> : null}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No students match that search.</Text>}
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
  nameAr: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  email: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  arrow: { fontSize: 16, color: colors.textFaint, marginLeft: spacing.sm },
  expandArea: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  enrollmentRow: {
    paddingVertical: 8,
  },
  enrollmentMain: { flexDirection: 'row', alignItems: 'center' },
  teacherName: { fontSize: 14, fontWeight: '600', color: colors.text },
  groupText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  changeText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '1f' },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textFaint },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 8, marginBottom: 8 },
});
