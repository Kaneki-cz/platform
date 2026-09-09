import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, gradientBrand, radius, spacing } from '@/constants/theme';

// Matches backend settings.VERIFICATION_RESEND_COOLDOWN_SECONDS (see
// backend/app/core/config.py) — only used to start the countdown right
// after a successful send; the backend is still the real source of truth
// (a 429 response's message carries the actual remaining seconds if this
// screen's own timer and the server ever drift, e.g. after backgrounding
// the app for a while).
const RESEND_COOLDOWN_SECONDS = 60;
// Matches backend settings.VERIFICATION_CODE_EXPIRE_MINUTES — shown in the
// hero card so the student knows how long they have, not enforced here.
const CODE_EXPIRE_MINUTES = 10;
const CODE_LENGTH = 6;

const STRINGS = {
  ar: {
    heroTitle: 'تأكيد الحساب',
    heroSubtitle: (email: string) => `بعتنا كود لـ ${email} — صالح لمدة ${CODE_EXPIRE_MINUTES} دقايق`,
    cardLabel: 'اكتب الكود اللي وصلك',
    verify: 'تأكيد',
    resendReadyIn: 'إعادة الإرسال متاحة بعد',
    resendPrefix: 'ملقتش الكود؟',
    resend: 'إعادة الإرسال',
    resendSent: 'تم إرسال كود جديد لإيميلك.',
    genericError: 'حصلت مشكلة. حاول تاني.',
    missingEmail: 'مفيش إيميل محدد — ارجع لشاشة التسجيل وجرب تاني.',
  },
  en: {
    heroTitle: 'Verify your account',
    heroSubtitle: (email: string) => `We sent a code to ${email} — valid for ${CODE_EXPIRE_MINUTES} minutes`,
    cardLabel: 'Enter the code you received',
    verify: 'Verify',
    resendReadyIn: 'Resend available in',
    resendPrefix: "Didn't get a code?",
    resend: 'Resend',
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

  // One string per digit box (see the boxes' own onChangeText/onKeyPress
  // below for the auto-advance/backspace/paste handling) rather than a
  // single string + substring math — simplest way to keep each box's
  // displayed value and the shared focus-movement logic in sync.
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const code = digits.join('');

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

  // Handles both normal one-key-at-a-time typing AND pasting the whole code
  // at once (the OS clipboard paste lands the full string in whichever box
  // had focus — usually the first). `text` here is the box's value AFTER
  // the keystroke/paste, already whatever RN handed back.
  const onDigitChange = (index: number, text: string) => {
    const clean = text.replace(/[^0-9]/g, '');
    if (clean.length > 1) {
      // Pasted (or predictive-keyboard-filled) more than one digit at once
      // — spread it across this box and the ones after it.
      setDigits((prev) => {
        const next = [...prev];
        for (let i = 0; i < clean.length && index + i < CODE_LENGTH; i++) {
          next[index + i] = clean[i];
        }
        return next;
      });
      const lastFilled = Math.min(index + clean.length, CODE_LENGTH) - 1;
      inputRefs.current[Math.min(lastFilled + 1, CODE_LENGTH - 1)]?.focus();
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      next[index] = clean;
      return next;
    });
    if (clean && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const onDigitKeyPress = (index: number, key: string) => {
    // Backspace on an already-empty box jumps back and clears the previous
    // one too — matches how every real OTP input behaves, rather than
    // getting stuck unable to go back once a box is empty.
    if (key === 'Backspace' && !digits[index] && index > 0) {
      setDigits((prev) => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
      inputRefs.current[index - 1]?.focus();
    }
  };

  const onSubmit = async () => {
    if (!email) {
      setError(t.missingEmail);
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await verifyEmail(email, code);
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
      <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroBlob} pointerEvents="none" />
        <Text style={styles.heroIcon}>🔐</Text>
        <Text style={styles.heroTitle}>{t.heroTitle}</Text>
        <Text style={styles.heroSubtitle}>{t.heroSubtitle(email || '—')}</Text>
      </LinearGradient>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>{t.cardLabel}</Text>

        <View style={styles.digitsRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              style={[styles.digitBox, digit && styles.digitBoxFilled]}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH} // allows a full paste to land in one box, see onDigitChange
              value={digit}
              onChangeText={(v) => onDigitChange(index, v)}
              onKeyPress={({ nativeEvent }) => onDigitKeyPress(index, nativeEvent.key)}
              textAlign="center"
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable onPress={onSubmit} disabled={submitting || code.length !== CODE_LENGTH}>
          {({ pressed }) => (
            <LinearGradient
              colors={gradientBrand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.button,
                (pressed || submitting || code.length !== CODE_LENGTH) && styles.buttonFaded,
              ]}
            >
              {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{t.verify}</Text>}
            </LinearGradient>
          )}
        </Pressable>

        <View style={styles.resendBox}>
          <Text style={styles.resendLabel}>{cooldown > 0 ? t.resendReadyIn : t.resendPrefix}</Text>
          {cooldown > 0 ? (
            // A simple static ring (one accent-colored border side, rotated)
            // rather than a true animated sweep — RN's plain View borders
            // can't draw an arbitrary arc without pulling in an SVG library,
            // and this app deliberately has none (see the project's own
            // "new native dependency needs a full eas build, not just eas
            // update" rule) — this reads clearly as "a countdown is running"
            // without that cost.
            <View style={styles.ring}>
              <Text style={styles.ringText}>{cooldown}</Text>
            </View>
          ) : resending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Pressable onPress={onResend} hitSlop={8}>
              <Text style={styles.resendLink}>{t.resend}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },

  // --- Hero (gradient) card ---
  hero: {
    borderRadius: radius.lg + 4,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  // Soft translucent circle peeking from the top-left corner — purely
  // decorative, matches the mockup's "not just a flat gradient" texture.
  heroBlob: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -60,
    left: -40,
  },
  heroIcon: { fontSize: 30, marginBottom: spacing.xs },
  heroTitle: { color: colors.onPrimary, fontSize: 19, fontWeight: '800', marginBottom: 4 },
  heroSubtitle: { color: 'rgba(4,33,43,0.75)', fontSize: 13, lineHeight: 19 },

  // --- Code card ---
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg + 2,
    padding: spacing.lg,
  },
  cardLabel: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },

  digitsRow: { flexDirection: 'row-reverse', justifyContent: 'center', gap: spacing.sm },
  digitBox: {
    width: 42,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  digitBoxFilled: { borderColor: colors.primary, color: colors.primary },

  error: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  notice: { color: colors.success, marginTop: spacing.md, textAlign: 'center' },

  button: {
    borderRadius: radius.pill,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonFaded: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },

  resendBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  resendLabel: { color: colors.textMuted, fontSize: 12.5 },
  resendLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: colors.border,
    borderTopColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  ringText: { color: colors.primary, fontSize: 10, fontWeight: '700', transform: [{ rotate: '90deg' }] },
});
