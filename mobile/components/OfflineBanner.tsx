import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLanguage } from '@/context/LanguageContext';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { getApiBaseUrl } from '@/lib/config';
import { isOffline, setOffline, subscribeOffline } from '@/lib/network';

const RECHECK_MS = 8000;

const STRINGS = {
  ar: 'مفيش اتصال بالسيرفر — هنكمّل أول ما النت يرجع',
  en: "Can't reach the server — we'll pick up as soon as you're back online",
};

/** Slim banner at the top of every screen while the server is unreachable.
 * Polls /health quietly so it clears itself once the connection returns,
 * even if the student doesn't tap anything. */
export function OfflineBanner() {
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const [offline, setOfflineState] = useState(isOffline());

  useEffect(() => subscribeOffline(setOfflineState), []);

  useEffect(() => {
    if (!offline) return undefined;
    const timer = setInterval(() => {
      fetch(`${getApiBaseUrl()}/health`)
        .then((r) => {
          if (r.ok) setOffline(false);
        })
        .catch(() => {});
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [offline]);

  if (!offline) return null;
  return (
    <Animated.View
      entering={FadeInUp.duration(250)}
      exiting={FadeOutUp.duration(250)}
      style={[styles.banner, { top: insets.top + spacing.xs }]}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.text} />
      <Text style={styles.text}>{STRINGS[language]}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: `${colors.danger}66`,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    zIndex: 1000,
    elevation: 20,
  },
  text: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 12.5 },
});
