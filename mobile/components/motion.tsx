import React, { useEffect, useRef, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { colors, gradientBrand, radius } from '@/constants/theme';

/**
 * Shared motion primitives — the one place the app's "feel" is tuned, so
 * every screen springs, staggers and pulses the same way instead of each
 * hand-rolling its own timings. Everything here runs on the UI thread via
 * Reanimated (already linked in the native build — see admin/index.tsx and
 * exams/[examId].tsx), so it ships as a plain JS/OTA update with no new APK.
 * Reanimated's layout animations follow the OS "reduce motion" setting by
 * default, so students who turn animations off get static screens.
 */

export const springs = {
  /** Snappy press feedback — quick in, slight settle out. */
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  /** Things that travel (the tab bar's sliding pill). */
  glide: { damping: 20, stiffness: 210, mass: 0.9 },
} as const;

/** Staggered entrance for list items: each row rises + fades in a beat
 * after the one above it. Capped so a long list doesn't make the last row
 * wait seconds to appear. */
export function enterStagger(index: number, base = 0) {
  return FadeInDown.delay(base + Math.min(index, 8) * 55)
    .springify()
    .damping(17)
    .stiffness(170);
}

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far the element shrinks while held. */
  scaleTo?: number;
};

/** Drop-in replacement for <Pressable> that shrinks slightly while held and
 * springs back on release — the tactile "push" feel of native apps. */
export function PressableScale({ style, scaleTo = 0.965, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressableBase
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, springs.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, springs.press);
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
    />
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Circular progress ring that sweeps from 0 up to `percent` on mount (and
 * animates between values when it changes), drawn in the brand gradient. */
export function ProgressRing({
  percent,
  size = 84,
  stroke = 9,
  children,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(100, percent)) / 100, {
      duration: 1300,
      easing: Easing.out(Easing.cubic),
    });
  }, [percent, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradientBrand[0]} />
            <Stop offset="1" stopColor={gradientBrand[1]} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </Animated.View>
  );
}

/** Counts a number up from 0 to `target` (ease-out), for scores and stats.
 * Runs on the JS thread via requestAnimationFrame — it only re-renders one
 * short <Text>, so that's cheaper than bridging every frame from a worklet. */
export function useCountUp(target: number, duration = 1100) {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);
  return value;
}

/** Pulsing placeholder block shown while data loads, instead of an empty
 * screen — keeps the layout's shape so nothing jumps when content lands. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.9, { duration: 700 }), withTiming(0.45, { duration: 700 })),
      -1,
    );
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.skeleton, style, animatedStyle]} />;
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
});

function Dot({ delay, color }: { delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 320 }), withTiming(0, { duration: 320 })), -1),
    );
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + t.value * 0.65,
    transform: [{ translateY: -3 * t.value }],
  }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

/** Three bouncing dots — "someone is typing". */
export function TypingDots({ color = colors.accent }: { color?: string }) {
  return (
    <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 12 }}>
      <Dot delay={0} color={color} />
      <Dot delay={140} color={color} />
      <Dot delay={280} color={color} />
    </Animated.View>
  );
}
