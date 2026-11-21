import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';

import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { ApiError, getMyStudentCode } from '@/lib/api';
import { PressableScale } from '@/components/motion';
import { colors, fonts, gradientBrand, radius, spacing } from '@/constants/theme';

const STRINGS = {
  ar: {
    student: 'طالب',
    proPlan: 'باقة Pro',
    freePlan: 'باقة مجانية',
    manageAdmin: 'إدارة المحتوى والمدرسين',
    manageInstructor: 'إدارة المحتوى',
    logout: 'تسجيل الخروج',
    logoutConfirmTitle: 'تسجيل الخروج؟',
    logoutConfirmMsg: 'هتحتاج تسجّل دخول تاني عشان تكمّل.',
    cancel: 'إلغاء',
    myCode: 'كود الحضور الخاص بي',
    myCodeHint: 'اعرض هذا الكود للمدرس ليمسحه ويسجل حضورك',
    myCodeError: 'تعذر تحميل الكود، حاول مرة أخرى',
  },
  en: {
    student: 'Student',
    proPlan: 'Pro plan',
    freePlan: 'Free plan',
    manageAdmin: 'Manage content and instructors',
    manageInstructor: 'Manage content',
    logout: 'Log out',
    logoutConfirmTitle: 'Log out?',
    logoutConfirmMsg: "You'll need to sign in again to continue.",
    cancel: 'Cancel',
    myCode: 'My attendance code',
    myCodeHint: 'Show this to your teacher to scan and mark you present',
    myCodeError: "Couldn't load your code, try again",
  },
};

/** Student-only "my QR code" card — fetches/lazily-creates this student's
 * permanent attendance code (see lib/api.ts's getMyStudentCode) and renders
 * it as a scannable QR, for a teacher/admin to scan from the group
 * attendance scanner (app/admin/attendance/[groupId].tsx). Always wrapped in
 * a plain white box regardless of the app's dark theme — a QR rendered on a
 * dark background doesn't scan reliably. */
function MyAttendanceCode({ t }: { t: (typeof STRINGS)['ar'] }) {
  const [code, setCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getMyStudentCode()
      .then((res) => {
        if (!cancelled) setCode(res.code);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('getMyStudentCode failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.codeCard}>
      <Text style={styles.codeCardTitle}>{t.myCode}</Text>
      <View style={styles.qrBox}>
        {code ? (
          <QRCode value={code} size={148} backgroundColor="#ffffff" color="#0B0F19" />
        ) : error ? (
          <Text style={styles.codeError}>{t.myCodeError}</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
      {code ? <Text style={styles.codeText}>{code}</Text> : null}
      <Text style={styles.codeHint}>{t.myCodeHint}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { language } = useLanguage();
  const t = STRINGS[language];
  const router = useRouter();
  const canManage = user?.role === 'instructor' || user?.role === 'admin';

  const confirmLogout = () => {
    Alert.alert(t.logoutConfirmTitle, t.logoutConfirmMsg, [
      { text: t.cancel, style: 'cancel' },
      { text: t.logout, style: 'destructive', onPress: logout },
    ]);
  };

  return (
    // Was a plain View — on a shorter screen (or in landscape) the content
    // (avatar, name, badge, the QR code card for students, manage button,
    // logout) could add up to taller than the visible area with no way to
    // reach whatever fell below the fold, logout included. A ScrollView
    // costs nothing when everything already fits (it just doesn't scroll)
    // and fixes it the moment it doesn't.
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* Gradient avatar (2026 redesign pass, missed in the first implementation
          pass) — same treatment as the login screen's Ω mark, instead of a
          flat cyan circle. */}
      <Animated.View entering={FadeInDown.duration(400)} style={styles.identity}>
      <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
        <Text style={styles.avatarText}>{(user?.full_name ?? user?.email ?? '?').charAt(0).toUpperCase()}</Text>
      </LinearGradient>

      <Text style={styles.name}>{user?.full_name || t.student}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.badge}>
        <Text style={styles.badgeText}>{user?.plan === 'pro' ? t.proPlan : t.freePlan}</Text>
      </View>
      </Animated.View>

      {user?.role === 'student' ? (
        <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={styles.fullWidth}>
          <MyAttendanceCode t={t} />
        </Animated.View>
      ) : null}

      {canManage ? (
        // Gradient pill (2026 redesign pass, missed in the first
        // implementation pass) — was a flat cyan rectangle, same as every
        // other primary action button in the app now.
        <Animated.View entering={FadeInDown.delay(200)} style={styles.fullWidth}>
          <PressableScale onPress={() => router.push('/admin')} style={styles.manageButtonWrap} accessibilityRole="button">
            <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.manageButton}>
              <Ionicons name="construct-outline" size={18} color={colors.onPrimary} />
              <Text style={styles.manageButtonText}>{user?.role === 'admin' ? t.manageAdmin : t.manageInstructor}</Text>
            </LinearGradient>
          </PressableScale>
        </Animated.View>
      ) : null}

      <Pressable style={styles.logoutButton} onPress={confirmLogout} accessibilityRole="button" hitSlop={6}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>{t.logout}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { alignItems: 'center', padding: spacing.xl, paddingTop: 60, paddingBottom: 40, flexGrow: 1 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  identity: { alignItems: 'center', alignSelf: 'stretch' },
  fullWidth: { alignSelf: 'stretch' },
  avatarText: { color: colors.onPrimary, fontSize: 32, fontFamily: fonts.bold },
  name: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  email: { color: colors.textMuted, marginTop: 2, fontFamily: fonts.regular },
  badge: { backgroundColor: colors.accent + '1F', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, marginTop: spacing.md },
  badgeText: { color: colors.accent, fontFamily: fonts.semiBold },
  codeCard: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  codeCardTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: spacing.md },
  qrBox: {
    width: 172,
    height: 172,
    borderRadius: radius.md,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeError: { color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.md, fontSize: 12 },
  codeText: { color: colors.text, fontFamily: fonts.bold, fontSize: 18, letterSpacing: 2, marginTop: spacing.md },
  codeHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, textAlign: 'center', fontFamily: fonts.regular },
  manageButtonWrap: { marginTop: 24, alignSelf: 'stretch' },
  manageButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  manageButtonText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 15 },
  logoutButton: { marginTop: 24, padding: 14, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoutText: { color: colors.danger, fontFamily: fonts.semiBold, fontSize: 16 },
});
