import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, radius, spacing } from '@/constants/theme';

const STRINGS = {
  ar: {
    title: 'اعمل حسابك',
    fullName: 'الاسم بالكامل',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signUp: 'إنشاء حساب',
    haveAccount: 'عندك حساب بالفعل؟ سجّل دخولك',
    genericError: 'حصلت مشكلة. حاول تاني.',
  },
  en: {
    title: 'Create your account',
    fullName: 'Full name',
    email: 'Email',
    password: 'Password',
    signUp: 'Sign Up',
    haveAccount: 'Already have an account? Log in',
    genericError: 'Something went wrong. Please try again.',
  },
};

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const { language, toggleLanguage } = useLanguage();
  const t = STRINGS[language];
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const trimmedEmail = email.trim();
      const alreadyVerified = await register(trimmedEmail, password, fullName.trim() || undefined);
      if (!alreadyVerified) {
        router.push({ pathname: '/(auth)/verify-email', params: { email: trimmedEmail } });
      }
      // else: already logged in (see AuthContext.register) — AuthGate will
      // redirect to (tabs) on its own, nothing to navigate here.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.langButton} onPress={toggleLanguage} hitSlop={8}>
        <Text style={styles.langButtonText}>{language === 'ar' ? 'EN' : 'ع'}</Text>
      </Pressable>

      <Text style={styles.title}>{t.title}</Text>

      <TextInput
        style={styles.input}
        placeholder={t.fullName}
        placeholderTextColor="#9ca3af"
        value={fullName}
        onChangeText={setFullName}
      />
      <TextInput
        style={styles.input}
        placeholder={t.email}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder={t.password}
        placeholderTextColor="#9ca3af"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{t.signUp}</Text>}
      </Pressable>

      <Link href="/(auth)/login" style={styles.link}>
        {t.haveAccount}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  langButton: {
    position: 'absolute',
    top: 56,
    right: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  langButtonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 32, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonPressed: { backgroundColor: colors.primaryDark },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: spacing.sm, textAlign: 'center' },
  link: { marginTop: 20, textAlign: 'center', color: colors.primary },
});
