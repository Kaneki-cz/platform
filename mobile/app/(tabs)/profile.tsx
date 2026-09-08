import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { colors, gradientBrand, radius, spacing } from '@/constants/theme';

const STRINGS = {
  ar: {
    student: 'طالب',
    proPlan: 'باقة Pro',
    freePlan: 'باقة مجانية',
    manageAdmin: '🛠️ إدارة المحتوى والمدرسين',
    manageInstructor: '🛠️ إدارة المحتوى',
    logout: 'تسجيل الخروج',
    language: 'اللغة',
    languageArabic: 'العربية',
    languageEnglish: 'English',
  },
  en: {
    student: 'Student',
    proPlan: 'Pro plan',
    freePlan: 'Free plan',
    manageAdmin: '🛠️ Manage Content & Instructors',
    manageInstructor: '🛠️ Manage Content',
    logout: 'Log out',
    language: 'Language',
    languageArabic: 'العربية',
    languageEnglish: 'English',
  },
};

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const t = STRINGS[language];
  const router = useRouter();
  const canManage = user?.role === 'instructor' || user?.role === 'admin';

  return (
    <View style={styles.container}>
      {/* Gradient avatar (2026 redesign pass, missed in the first implementation
          pass) — same treatment as the login screen's Ω mark, instead of a
          flat cyan circle. */}
      <LinearGradient colors={gradientBrand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
        <Text style={styles.avatarText}>{(user?.full_name ?? user?.email ?? '?').charAt(0).toUpperCase()}</Text>
      </LinearGradient>

      <Text style={styles.name}>{user?.full_name || t.student}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.badge}>
        <Text style={styles.badgeText}>{user?.plan === 'pro' ? t.proPlan : t.freePlan}</Text>
      </View>

      <View style={styles.languageRow}>
        <Text style={styles.languageLabel}>{t.language}</Text>
        <View style={styles.languageSwitch}>
          <Pressable
            style={[styles.languageOption, language === 'ar' && styles.languageOptionActive]}
            onPress={() => setLanguage('ar')}
          >
            <Text style={[styles.languageOptionText, language === 'ar' && styles.languageOptionTextActive]}>
              {t.languageArabic}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.languageOption, language === 'en' && styles.languageOptionActive]}
            onPress={() => setLanguage('en')}
          >
            <Text style={[styles.languageOptionText, language === 'en' && styles.languageOptionTextActive]}>
              {t.languageEnglish}
            </Text>
          </Pressable>
        </View>
      </View>

      {canManage ? (
        // Gradient pill (2026 redesign pass, missed in the first
        // implementation pass) — was a flat cyan rectangle, same as every
        // other primary action button in the app now.
        <Pressable onPress={() => router.push('/admin')} style={styles.manageButtonWrap}>
          {({ pressed }) => (
            <LinearGradient
              colors={gradientBrand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.manageButton, pressed && styles.manageButtonPressed]}
            >
              <Text style={styles.manageButtonText}>{user?.role === 'admin' ? t.manageAdmin : t.manageInstructor}</Text>
            </LinearGradient>
          )}
        </Pressable>
      ) : null}

      <Pressable style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>{t.logout}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', padding: spacing.xl, paddingTop: 60 },
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
  avatarText: { color: colors.onPrimary, fontSize: 32, fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  email: { color: colors.textMuted, marginTop: 4 },
  badge: { backgroundColor: colors.accent + '1F', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, marginTop: spacing.md },
  badgeText: { color: colors.accentDark, fontWeight: '600' },
  languageRow: {
    marginTop: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  languageLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  languageSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  languageOption: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: radius.pill },
  languageOptionActive: { backgroundColor: colors.primary },
  languageOptionText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  languageOptionTextActive: { color: colors.onPrimary },
  manageButtonWrap: { marginTop: 24, alignSelf: 'stretch' },
  manageButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  manageButtonPressed: { opacity: 0.85 },
  manageButtonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 15 },
  logoutButton: { marginTop: 24, padding: 14 },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 16 },
});
