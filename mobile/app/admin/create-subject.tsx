import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, createSubject } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';

export default function CreateSubjectScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!name.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await createSubject(name.trim());
      router.back();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Create subject failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Subject name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Physics"
        placeholderTextColor="#9ca3af"
        value={name}
        onChangeText={setName}
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Create</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  label: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
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
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 12 },
});
