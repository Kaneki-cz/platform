import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, gradientBrand, radius, spacing } from '@/constants/theme';

// How many quick taps on the title reveal the (otherwise hidden) server
// settings screen — see the comment on that screen and on the tap handler
// below for why this isn't a plain visible link.
const SECRET_TAP_COUNT = 7;
const SECRET_TAP_WINDOW_MS = 2000;

const STRINGS = {
  ar: {
    title: 'منصة الفيزياء',
    subtitle: 'سجّل دخولك عشان تكمل التعلم',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    logIn: 'تسجيل الدخول',
    noAccount: 'معندكش حساب؟ اعمل واحد',
    genericError: 'حصلت مشكلة. حاول تاني.',
  },
  en: {
    title: 'Physics Platform',
    subtitle: 'Log in to continue learning',
    email: 'Email',
    password: 'Password',
    logIn: 'Log In',
    noAccount: "Don't have an account? Sign up",
    genericError: 'Something went wrong. Please try again.',
  },
};

export default function LoginScreen() {
  const { login } = useAuth();
  const { language, toggleLanguage } = useLanguage();
  const router = useRouter();
  const t = STRINGS[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Deliberately not a visible link (unlike a typical dev/testing screen) —
  // this build ships to students, and letting anyone casually notice and
  // repoint the app at a different (possibly malicious) backend would be a
  // real security problem. Tapping the title several times quickly is the
  // same "hidden developer options" pattern Android's own settings use, so
  // whoever set up this test build can still reach it without a rebuild.
  //
  // NOTE (2026 redesign pass): the new Ω logo mark above the title is its
  // own separate Pressable-free View — the secret-tap gesture stays exactly
  // where it was, on the title text only, so this doesn't change how many
  // taps or where they need to land.
  const tapTimestamps = useRef<number[]>([]);
  const onTitlePress = () => {
    const now = Date.now();
    tapTimestamps.current = [...tapTimestamps.current, now].filter((t) => now - t < SECRET_TAP_WINDOW_MS);
    if (tapTimestamps.current.length >= SECRET_TAP_COUNT) {
      tapTimestamps.current = [];
      router.push('/server-settings');
    }
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      // 403 here specifically means "right password, account just isn't
      // verified yet" (see backend app/api/routes/auth.py's /login) — route
      // straight to the verify-email screen instead of showing a dead-end
      // error, and have it fetch a fresh code since whatever code was sent
      // at registration time may well have expired by now.
      if (e instanceof ApiError && e.status === 403) {
        router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim(), autoResend: '1' } });
        return;
      }
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

      <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoMark}>
        <Text style={styles.logoMarkText}>Ω</Text>
      </LinearGradient>

      <Pressable onPress={onTitlePress}>
        <Text style={styles.title}>{t.title}</Text>
      </Pressable>
      <Text style={styles.subtitle}>{t.subtitle}</Text>

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

      <Pressable onPress={onSubmit} disabled={submitting}>
        {({ pressed }) => (
          <LinearGradient
            colors={gradientBrand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.button, pressed && styles.buttonPressed]}
          >
            {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{t.logIn}</Text>}
          </LinearGradient>
        )}
      </Pressable>

      <Link href="/(auth)/register" style={styles.link}>
        {t.noAccount}
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
  // Ω brand mark (2026 redesign pass) — same gradient as the tab bar / CTA
  // button, giving the login screen a visual anchor instead of jumping
  // straight to plain text.
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  logoMarkText: { color: colors.onPrimary, fontSize: 34, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', color: colors.text, letterSpacing: 0.2 },
  subtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, marginBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg + 4,
    marginBottom: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  button: {
    borderRadius: radius.pill,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: spacing.sm, textAlign: 'center' },
  link: { marginTop: 20, textAlign: 'center', color: colors.primary },
});
