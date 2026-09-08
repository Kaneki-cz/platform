import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gradientBrand, radius } from '@/constants/theme';

/**
 * Custom floating bottom tab bar — 2026 redesign pass. Replaces the default
 * React Navigation bar (a flat, edge-to-edge rectangle) with a pill-shaped
 * bar that floats above the screen content, plus a gradient-tinted capsule
 * behind whichever tab is active (only the active tab shows its label — the
 * others stay icon-only, dimmed). See constants/theme.ts's `gradientBrand`
 * comment for why cyan->violet specifically.
 *
 * Still driven entirely by the <Tabs.Screen> options set up in _layout.tsx
 * (title, tabBarIcon) — this component only changes how those are laid out
 * and styled, not the navigation logic itself, so tab-specific behavior
 * (like Courses' "reset to list" tabPress listener) keeps working untouched.
 */
export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = options.title ?? route.name;
          const icon = options.tabBarIcon?.({ focused, color: '', size: 22 });

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item} hitSlop={6}>
              {focused ? (
                <LinearGradient
                  colors={[`${gradientBrand[0]}29`, `${gradientBrand[1]}29`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.activePill}
                >
                  {icon}
                  <Text style={styles.activeLabel} numberOfLines={1}>
                    {label}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactivePill}>{icon}</View>
              )}
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${colors.violet}38`,
    // BlurView handles the frosted background itself; this shadow is what
    // actually lifts the bar off the screen content behind it.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  item: { flex: 1 },
  inactivePill: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: radius.pill },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: `${colors.primary}59`,
  },
  activeLabel: { color: colors.primary, fontSize: 11.5, fontWeight: '700' },
});
