import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, radius, spacing } from '@/constants/theme';

// Matches backend settings.VERIFICATION_RESEND_COOLDOWN_SECONDS (see
// backend/app/core/config.py) — only used to start the countdown right
// after a successful send; the backend is still the real source of truth
// (a 429 response's message carries the actual remaining seconds if this
// screen's own timer and the server ever drift, e.g. after backgrounding
// the app for a while).
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

const STRINGS = {
  ar: {
    title: 'تأكيد الإيميل',
    subtitle: (email: string) => `بعتنا كود مكوّن من ${CODE_LENGTH} أرقام على ${email}`,
    codePlaceholder: 'اكتب الكود هنا',
    verify: 'تأكيد',
    resendPrefix: 'ملقتش الكود؟',
    resend: 'أعد الإرسال',
    resendWait: (s: number) => `أعد الإرسال (${s})`,
    resendSent: 'تم إرسال كود جديد لإيميلك.',
    genericError: 'حصلت مشكلة. حاول تاني.',
    missingEmail: 'مفيش إيميل محدد — ارجع لشاشة التسجيل وجرب تاني.',
  },
  en: {
    title: 'Verify your email',
    subtitle: (email: string) => `We sent a ${CODE_LENGTH}-digit code to ${email}`,
    codePlaceholder: 'Enter the code',
    verify: 'Verify',
    resendPrefix: "Didn't get a code?",
    resend: 'Resend',
    resendWait: (s: number) => `Resend (${s})`,
    resendSent: 'A new code was sent to your email.',
    genericError: 'Something went wrong. Please try again.',
    missingEmail: 'No email to verify — go back to the sign-up screen and try again.',
  },
};

export default function VerifyEmailScreen() {
  const { verifyEmail, resendVerification } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const t = STRINGS[language];
  const params = useLocalSearchParams<{ email?: string; autoResend?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Ticks the resend cooldown down once a second — purely a UI countdown,
  // the backend enforces the real limit independently (see the 429 handling
  // in onResend below).
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Coming here straight from a "login blocked, not verified yet" redirect
  // (see login.tsx) means whatever code was sent at registration time is
  // very likely long expired — fire off a fresh one automatically instead
  // of making the student notice and tap Resend themselves.
  const autoResendFired = useRef(false);
  useEffect(() => {
    if (params.autoResend === '1' && email && !autoResendFired.current) {
      autoResendFired.current = true;
      resendVerification(email)
        .then(() => setCooldown(RESEND_COOLDOWN_SECONDS))
        .catch(() => {
          // Silent — the student can still tap Resend manually below, and
          // an error here (e.g. one was *just* sent) isn't worth surfacing
          // before they've even seen the screen.
        });
    }
  }, [params.autoResend, email, resendVerification]);

  const onSubmit = async () => {
    if (!email) {
      setError(t.missingEmail);
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await verifyEmail(email, code.trim());
      // No manual navigation needed — AuthGate (components/AuthGate.tsx)
      // redirects to (tabs) as soon as `user` is set, same as login.tsx.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!email || cooldown > 0) return;
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      await resendVerification(email);
      setNotice(t.resendSent);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      if (e instanceof ApiError) {
        // The backend's 429 message already names the exact remaining
        // seconds (see backend app/api/routes/auth.py's /resend-verification)
        // — pull that number out to sync this screen's own countdown to it
        // rather than showing a redundant error on top of a running timer.
        const match = /(\d+)/.exec(e.message);
        if (e.status === 429 && match) {
          setCooldown(parseInt(match[1], 10));
        } else {
          setError(e.message);
        }
      } else {
        setError(t.genericError);
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.subtitle}>{t.subtitle(email || '—')}</Text>

      <TextInput
        style={styles.codeInput}
        placeholder={t.codePlaceholder}
        placeholderTextColor="#9ca3af"
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        value={code}
        onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))}
        textAlign="center"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onSubmit}
        disabled={submitting || code.length !== CODE_LENGTH}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{t.verify}</Text>}
      </Pressable>

      <View style={styles.resendRow}>
        <Text style={styles.resendPrefix}>{t.resendPrefix}</Text>
        <Pressable onPress={onResend} disabled={resending || cooldown > 0} hitSlop={8}>
          {resending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.resendLink, cooldown > 0 && styles.resendLinkDisabled]}>
              {cooldown > 0 ? t.resendWait(cooldown) : t.resend}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: spacing.sm, color: colors.text },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 32,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.md,
    fontSize: 24,
    letterSpacing: 8,
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
  notice: { color: colors.success, marginBottom: spacing.sm, textAlign: 'center' },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 24,
  },
  resendPrefix: { color: colors.textMuted, fontSize: 13 },
  resendLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  resendLinkDisabled: { color: colors.textMuted },
});
