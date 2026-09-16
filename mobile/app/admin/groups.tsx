import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, createTeacherGroup, deleteTeacherGroup, listTeacherGroups, myTeacherProfile } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { Teacher, TeacherGroup } from '@/lib/types';

/** Instructor-facing self-service screen — reached from the instructor's own
 * home screen (app/admin/index.tsx), unlike the near-identical "Student
 * groups" box inside app/admin/subject/[id].tsx's editingTeacher block,
 * which only an ADMIN can reach (by opening the teacher's card). The
 * backend has always permitted an instructor to manage their own
 * teacher_id's groups and scan its attendance (see
 * _require_teacher_owner_or_admin in enrollment.py and
 * _ensure_can_manage_group in attendance.py) — this screen just gives the
 * instructor a door to it from their own account, using the new
 * GET /api/v1/teachers/mine endpoint to resolve "my own teacher_id" without
 * depending on having any chapter assigned yet (myManagedCourses can be
 * empty for a freshly-linked instructor, which is why that list isn't used
 * here instead). */
export default function MyGroupsScreen() {
  const router = useRouter();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [notLinked, setNotLinked] = useState(false);
  const [groups, setGroups] = useState<TeacherGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    myTeacherProfile()
      .then((t) => {
        setTeacher(t);
        setNotLinked(false);
        return listTeacherGroups(t.id).then(setGroups);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          setNotLinked(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const onAddGroup = async () => {
    if (!teacher || !newGroupName.trim()) return;
    setGroupError(null);
    setGroupSubmitting(true);
    try {
      const created = await createTeacherGroup(teacher.id, newGroupName.trim());
      setGroups((prev) => [...prev, created]);
      setNewGroupName('');
    } catch (e) {
      setGroupError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setGroupSubmitting(false);
    }
  };

  const onDeleteGroup = (groupId: string, groupName: string) => {
    if (!teacher) return;
    Alert.alert(
      'Delete group?',
      `"${groupName}" will be removed. Students currently in this group will become ungrouped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTeacherGroup(teacher.id, groupId);
              setGroups((prev) => prev.filter((g) => g.id !== groupId));
            } catch (e) {
              Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (notLinked || !teacher) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>
          Your account isn't linked to a teacher card yet — ask an admin to link it before you can create groups.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.xl }}>
      <Text style={styles.hint}>
        Create named groups for your students. Students pick a group the first time they open one of your lessons.
      </Text>

      {groups.length > 0 ? (
        <View style={styles.groupList}>
          {groups.map((g) => (
            <View key={g.id} style={styles.groupRow}>
              <Text style={styles.groupName} numberOfLines={1}>
                {g.name}
              </Text>
              <View style={styles.groupRowActions}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/admin/attendance/[groupId]',
                      params: { groupId: g.id, teacherId: teacher.id, groupName: g.name },
                    })
                  }
                  hitSlop={8}
                >
                  <Text style={styles.scanLinkText}>📷 Scan attendance</Text>
                </Pressable>
                <Pressable onPress={() => onDeleteGroup(g.id, g.name)} hitSlop={8}>
                  <Text style={styles.removeText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No groups yet — add one below.</Text>
      )}

      <View style={styles.groupInputRow}>
        <TextInput
          style={[styles.input, styles.groupInput]}
          placeholder="Group name, e.g. المجموعة أ"
          placeholderTextColor="#9ca3af"
          value={newGroupName}
          onChangeText={setNewGroupName}
        />
        <Pressable
          style={[styles.groupAddButton, groupSubmitting && styles.submitBtnDisabled]}
          onPress={onAddGroup}
          disabled={groupSubmitting || !newGroupName.trim()}
        >
          {groupSubmitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.groupAddButtonText}>+ Add</Text>
          )}
        </Pressable>
      </View>
      {groupError ? <Text style={styles.error}>{groupError}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 13, color: colors.textFaint, marginBottom: spacing.lg },
  groupList: { gap: 8, marginBottom: spacing.md },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  groupName: { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1, marginEnd: 8 },
  groupRowActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  scanLinkText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  removeText: { color: colors.danger, fontWeight: '600', fontSize: 12 },
  empty: { color: colors.textFaint, marginBottom: spacing.md },
  groupInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  groupInput: { flex: 1 },
  groupAddButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  groupAddButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, marginTop: 10 },
});
