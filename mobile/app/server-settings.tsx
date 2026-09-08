import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { reportServerSettingsAttempt } from '@/lib/api';
import { getApiBaseUrlOverride, getDefaultApiBaseUrl, setApiBaseUrlOverride } from '@/lib/config';
import { colors, radius, spacing } from '@/constants/theme';

/**
 * Lets a person testing an already-installed build (an APK shared without
 * going through the Play Store, for example) point the app at whatever
 * backend URL they were given for that session — e.g. a temporary ngrok
 * tunnel, which gets a new address every time it's restarted on a free
 * ngrok plan. Saved on-device (see lib/config.ts); no rebuild needed to
 * change it.
 *
 * This screen only reaches students at all because it's reachable while
 * logged out (see AuthGate) and its entry point is a hidden 7-tap gesture
 * on the login screen's title, not a visible link — see login.tsx. Neither
 * of those actually stops someone from getting here on purpose, though, so
 * the screen itself is gated behind an access code known only to whoever
 * set up this test build. Getting the code wrong (or leaving it blank)
 * never reveals or changes anything — the code is checked fresh every time
 * the screen opens (nothing about "unlocked" is remembered on-device).
 */
const ACCESS_CODE = 'zzzqAAkaneki337788';

export default function ServerSettingsScreen() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [value, setValue] = useState(getApiBaseUrlOverride() ?? '');

  // Fire exactly once per visit to this screen, regardless of StrictMode's
  // double-invoke in dev or any re-render — reportServerSettingsAttempt
  // itself never throws, but there's no reason to spam the notification.
  const reportedOpen = useRef(false);
  useEffect(() => {
    if (reportedOpen.current) return;
    reportedOpen.current = true;
    reportServerSettingsAttempt('opened');
  }, []);

  const onUnlock = () => {
    if (codeInput === ACCESS_CODE) {
      setCodeError(null);
      setUnlocked(true);
      reportServerSettingsAttempt('unlock_success');
    } else {
      setCodeError('Wrong code.');
      reportServerSettingsAttempt('unlock_failed');
    }
  };

  const onSave = async () => {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      Alert.alert('Invalid URL', 'The server URL should start with http:// or https://');
      return;
    }
    await setApiBaseUrlOverride(trimmed || null);
    Alert.alert('Saved', trimmed ? 'The app will now use this server.' : 'Reverted to the default server.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  const onClear = async () => {
    await setApiBaseUrlOverride(null);
    setValue('');
  };

  if (!unlocked) {
    return (
      <View style={styles.container}>
        <View style={styles.lockedBox}>
          <Text style={styles.title}>Access Code</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter access code"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={codeInput}
            onChangeText={(text) => {
              setCodeInput(text);
              setCodeError(null);
            }}
            onSubmitEditing={onUnlock}
          />
          {codeError ? <Text style={styles.error}>{codeError}</Text> : null}
          <Pressable style={styles.button} onPress={onUnlock}>
            <Text style={styles.buttonText}>Unlock</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>Server Connection</Text>
      <Text style={styles.hint}>
        By default the app connects to: {'\n'}
        <Text style={styles.mono}>{getDefaultApiBaseUrl()}</Text>
        {'\n\n'}
        If someone gave you a different server address to test with (e.g. an ngrok link), paste it below. Leave it
        empty and save to go back to the default.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="https://example.ngrok-free.app"
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={value}
        onChangeText={setValue}
      />

      <Pressable style={styles.button} onPress={onSave}>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>
      <Pressable style={styles.clearButton} onPress={onClear}>
        <Text style={styles.clearButtonText}>Clear override</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  lockedBox: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.md, color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.xl },
  mono: { fontFamily: 'monospace', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: spacing.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  clearButton: { padding: 12, alignItems: 'center' },
  clearButtonText: { color: colors.danger, fontWeight: '600' },
  error: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
});
