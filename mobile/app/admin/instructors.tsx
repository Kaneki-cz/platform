import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, assignInstructor, listSubjectInstructors, listSubjects, unassignInstructor } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { Instructor, Subject } from '@/lib/types';

export default function InstructorsScreen() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selected, setSelected] = useState<Subject | null>(null);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listSubjects().then(setSubjects).catch(() => {});
  }, []);

  const loadInstructors = useCallback((subject: Subject) => {
    listSubjectInstructors(subject.id).then(setInstructors).catch(() => {});
  }, []);

  const selectSubject = (subject: Subject) => {
    setSelected(subject);
    setError(null);
    loadInstructors(subject);
  };

  const onAssign = async () => {
    if (!selected || !email.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await assignInstructor(selected.id, email.trim());
      setEmail('');
      loadInstructors(selected);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (userId: string) => {
    if (!selected) return;
    await unassignInstructor(selected.id, userId).catch(() => {});
    loadInstructors(selected);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.label}>Pick a subject</Text>
      <View style={styles.chipRow}>
        {subjects.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.chip, selected?.id === s.id && styles.chipSelected]}
            onPress={() => selectSubject(s)}
          >
            <Text style={[styles.chipText, selected?.id === s.id && styles.chipTextSelected]}>{s.name}</Text>
          </Pressable>
        ))}
      </View>

      {selected ? (
        <>
          <Text style={styles.sectionTitle}>Instructors for {selected.name}</Text>
          <FlatList
            data={instructors}
            keyExtractor={(i) => i.user_id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.instructorRow}>
                <View>
                  <Text style={styles.instructorName}>{item.full_name || item.email}</Text>
                  <Text style={styles.instructorEmail}>{item.email}</Text>
                </View>
                <Pressable onPress={() => onRemove(item.user_id)}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No instructors assigned yet.</Text>}
          />

          <Text style={styles.label}>Assign by email</Text>
          <Text style={styles.hint}>They must already have an account (ask them to sign up first).</Text>
          <TextInput
            style={styles.input}
            placeholder="teacher@example.com"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={onAssign} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Assign</Text>}
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.onPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: 12, marginBottom: spacing.sm, color: colors.text },
  instructorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  instructorName: { fontWeight: '600', color: colors.text },
  instructorEmail: { color: colors.textMuted, fontSize: 13 },
  removeText: { color: colors.danger, fontWeight: '600' },
  empty: { color: colors.textFaint, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 30 },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 12 },
});
