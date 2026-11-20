import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale, springs } from '@/components/motion';
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
  const count = state.routes.length;
  const [itemWidth, setItemWidth] = useState(0);
  const pillX = useSharedValue(0);

  // Width of one tab slot, measured from the bar itself (items are flex: 1,
  // so every slot is the same width) — the active pill is one shared view
  // that glides between slots, rather than each tab drawing its own.
  const onBarLayout = (e: LayoutChangeEvent) => {
    const inner = e.nativeEvent.layout.width - BAR_PADDING * 2 - BAR_BORDER * 2;
    setItemWidth((inner - ITEM_GAP * (count - 1)) / count);
  };

  useEffect(() => {
    if (!itemWidth) return;
    pillX.value = withSpring(state.index * (itemWidth + ITEM_GAP), springs.glide);
  }, [state.index, itemWidth, pillX]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={styles.bar} onLayout={onBarLayout}>
        {itemWidth > 0 ? (
          <Animated.View style={[styles.activePill, { width: itemWidth }, pillStyle]} pointerEvents="none">
            <LinearGradient
              colors={[`${gradientBrand[0]}29`, `${gradientBrand[1]}29`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
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
            <PressableScale key={route.key} onPress={onPress} style={styles.item} hitSlop={6} scaleTo={0.9}>
              <View style={styles.itemInner}>
                {icon}
                {focused ? (
                  <Animated.Text
                    entering={FadeIn.duration(220).delay(90)}
                    style={styles.activeLabel}
                    numberOfLines={1}
                  >
                    {label}
                  </Animated.Text>
                ) : null}
              </View>
            </PressableScale>
          );
        })}
      </BlurView>
    </View>
  );
}

const BAR_PADDING = 8;
const BAR_BORDER = 1;
const ITEM_GAP = 4;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ITEM_GAP,
    padding: BAR_PADDING,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${colors.violet}38`,
    width: '100%',
    // Uncapped, this bar stretched edge-to-edge on any screen — fine on a
    // phone in portrait, but on a wider layout (a tablet, or a phone
    // rotated to landscape) the 4 items (see `item` below, flex: 1 each)
    // spread out with huge gaps between icon/label instead of staying a
    // sensibly-sized floating bar. Capping the width and centering it
    // (rather than centering each item within a wider bar) keeps this
    // exact same look on every phone size and just stops it from growing
    // past a comfortable size on anything wider.
    maxWidth: 460,
    alignSelf: 'center',
    // BlurView handles the frosted background itself; this shadow is what
    // actually lifts the bar off the screen content behind it.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  item: { flex: 1 },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  // One shared capsule that slides under whichever tab is active (see
  // AppTabBar's pillX) instead of popping in/out per tab.
  activePill: {
    position: 'absolute',
    left: BAR_PADDING,
    top: BAR_PADDING,
    bottom: BAR_PADDING,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: `${colors.primary}59`,
    overflow: 'hidden',
  },
  activeLabel: { color: colors.primary, fontSize: 11.5, fontWeight: '700' },
});
