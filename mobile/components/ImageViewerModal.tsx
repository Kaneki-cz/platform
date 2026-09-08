import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ResolvedImage } from './ResolvedImage';
import { colors, fonts, radius, spacing } from '@/constants/theme';

const MAX_ZOOM = 4;

/**
 * Full-screen tap-to-view for a question/lecture diagram. Now has real
 * pinch-to-zoom + drag-to-pan (the same react-native-gesture-handler +
 * react-native-reanimated combo already used by ImageCropModal, both
 * already app dependencies — no new native module, safe to ship over
 * `eas update`) — a busy circuit diagram with small labeled values needs
 * more than a bigger static view to actually read. Double-tap resets zoom.
 *
 * Wrapped in its own GestureHandlerRootView because this renders inside a
 * <Modal>, which mounts as a separate native root on Android — the
 * app-level GestureHandlerRootView in app/_layout.tsx doesn't reach in
 * there (see ImageCropModal.tsx for the same pattern).
 *
 * Closing: the ✕ button always closes. Tapping the backdrop still closes
 * too, but the pannable image itself no longer does — once you can drag a
 * zoomed image around, "tap the image to close" would fight with "tap the
 * image to pan/zoom".
 */
export function ImageViewerModal({
  visible,
  url,
  onClose,
}: {
  visible: boolean;
  url: string | null | undefined;
  onClose: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset zoom/pan whenever a (possibly different) image opens, so the next
  // photo never inherits the previous one's zoom level.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [url, visible, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Snap back to centered when zoomed back out to (or past) 1x, instead
      // of leaving the image stranded off-center at its old pan position.
      if (scale.value <= 1) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture, doubleTapGesture);

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal visible={visible && !!url} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.imageWrap, imageAnimatedStyle]}>
              <ResolvedImage url={url} style={styles.image} containerStyle={styles.image} resizeMode="contain" />
            </Animated.View>
          </GestureDetector>
        </Pressable>

        <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>

        <View pointerEvents="none" style={styles.hintWrap}>
          <Text style={styles.hintText}>قرّب بإصبعين وابعد وحرّك الصورة، أو دبل تاب للرجوع لحجمها</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: { width: '92%', height: '78%' },
  image: { width: '100%', height: '100%' },
  closeButton: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { color: colors.text, fontSize: 18, fontFamily: fonts.semiBold },
  hintWrap: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
});
