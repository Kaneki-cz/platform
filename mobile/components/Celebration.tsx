import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { colors, gradientBrand } from '@/constants/theme';

const PALETTE = [gradientBrand[0], gradientBrand[1], colors.accent, colors.success, '#FACC15'];

/**
 * One-shot confetti burst (pure Reanimated views, no extra native library):
 * particles fly outward from the center, arc down under "gravity", spin and
 * fade. Rendered absolutely over its parent with pointerEvents off, so it
 * never blocks taps. Used on the exam result screen when a student passes.
 */
export function Celebration({ count = 22 }: { count?: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 90 + Math.random() * 90;
        return {
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed - 60,
          rot: (Math.random() - 0.5) * 720,
          color: PALETTE[i % PALETTE.length],
          w: 6 + Math.random() * 5,
          h: 9 + Math.random() * 7,
          round: i % 3 === 0,
          delay: Math.random() * 120,
        };
      }),
    [count],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.origin}>
        {particles.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </View>
    </View>
  );
}

function Particle({
  dx,
  dy,
  rot,
  color,
  w,
  h,
  round,
  delay,
}: {
  dx: number;
  dy: number;
  rot: number;
  color: string;
  w: number;
  h: number;
  round: boolean;
  delay: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }));
  }, [delay, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    return {
      opacity: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3,
      transform: [
        { translateX: dx * p },
        // Initial burst along dy, then gravity pulls it down (quadratic).
        { translateY: dy * p + 160 * p * p },
        { rotate: `${rot * p}deg` },
        { scale: p < 0.1 ? p * 10 : 1 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        { position: 'absolute', width: w, height: round ? w : h, borderRadius: round ? w / 2 : 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  origin: { position: 'absolute', top: 70, left: '50%' },
});
