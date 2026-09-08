/**
 * Renders a teacher photo / chapter cover image from whatever's stored in
 * photo_url / cover_image_url — which, exactly like Lesson.video_url, can
 * be a real http(s) link, a legacy relative /media/ path, or a private B2
 * "b2:<key>" marker that needs exchanging for a signed URL first (see
 * lib/api.ts's resolveFileUrl). Screens showing a GRID of these (teacher
 * cards, course covers) each need their own independent resolve — this
 * component owns that so call sites stay plain JSX instead of repeating the
 * async-resolve-in-a-useEffect dance from app/lessons/[id].tsx everywhere a
 * thumbnail shows up.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { resolveFileUrl } from '@/lib/api';
import { colors } from '@/constants/theme';

interface ResolvedImageProps {
  url: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** Shown in place of the image when `url` is empty (no photo set yet). */
  fallback?: React.ReactNode;
  /** 'cover' (the old, only behavior) crops to fill `style`'s box — right
   * for a face photo where losing the edges doesn't matter. 'contain' letterboxes
   * instead so the WHOLE image is always visible, which is what any diagram,
   * chart, or cover art needs (see 2026 "keep the whole image visible" pass —
   * question diagrams and chapter/lecture cover art were getting cropped
   * under 'cover' whenever the uploaded image's aspect ratio didn't exactly
   * match the display box). Defaults to 'cover' to keep every existing call
   * site (teacher/student avatars) looking exactly as it did before. */
  resizeMode?: 'cover' | 'contain';
}

export function ResolvedImage({ url, style, containerStyle, fallback, resizeMode = 'cover' }: ResolvedImageProps) {
  const [resolved, setResolved] = useState<string | null>(null);

  // Gentle opacity pulse (0.35 <-> 1) while a resolve is in flight, instead
  // of a flat static placeholder box — this component backs every cover
  // image/thumbnail in the app (poster-grid course cards, lesson covers,
  // question images), so one shimmer-ish loading state here upgrades all of
  // them at once. Plain RN Animated (not Reanimated) is enough for a single
  // looping opacity tween and keeps this component dependency-light.
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (!url) return undefined;
    resolveFileUrl(url)
      .then((u) => {
        if (!cancelled) setResolved(u);
      })
      .catch(() => {
        // A stale/broken image link shouldn't crash the screen — it just
        // stays a placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) {
    return <View style={containerStyle}>{fallback}</View>;
  }

  if (!resolved) {
    return (
      <Animated.View style={[containerStyle, styles.loading, { opacity: pulse }]}>
        <ActivityIndicator color={colors.primary} size="small" />
      </Animated.View>
    );
  }

  return <Image source={{ uri: resolved }} style={style} resizeMode={resizeMode} />;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center' },
});
