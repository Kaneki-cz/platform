/**
 * Interactive photo crop tool — pinch to zoom, drag to pan, confirm to get
 * back a cropped+resized local file. Used for teacher photos (square) and
 * chapter cover images (16:9), per the user's explicit choice of "أداة قص
 * تفاعلية كاملة" (a full interactive crop tool) over an automatic
 * "cover"-style fit.
 *
 * Built on react-native-gesture-handler + react-native-reanimated (both
 * already a dependency of this app) for the pan/pinch UI.
 *
 * How the crop math works: the source image is displayed at "cover" scale
 * (fills the fixed-aspect-ratio frame with no gaps) times a user pinch-zoom
 * multiplier (>=1), and can be panned within limits that always keep the
 * frame fully covered. On confirm, the frame's position relative to the
 * displayed image is converted back into ORIGINAL image pixel coordinates.
 *
 * The actual crop-to-file step runs in a HIDDEN react-native-webview (a
 * <canvas> draws the source image and exports the cropped region as a JPEG
 * data URL) instead of expo-image-manipulator. This was a deliberate
 * pivot: expo-image-manipulator is a NATIVE module — adding it required a
 * brand-new dev-client build, and Expo's free-tier EAS Build queue can run
 * to multiple hours at peak times with no guaranteed finish time. WebView
 * was already a linked native dependency in this app (used for YouTube
 * playback) before this feature existed, so doing the crop through it
 * needs zero new native linking and works on the CURRENT build immediately
 * — see cropViaWebView() below.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';

import { colors, radius, spacing } from '../constants/theme';

/**
 * Minimal, self-contained page loaded into the hidden WebView. Waits for a
 * {type:'crop', dataUri, crop:{x,y,width,height}, outputWidth, outputHeight}
 * message, draws just that source region onto a canvas sized to the output,
 * and posts back {type:'result', dataUrl} (a JPEG data: URL) — or
 * {type:'error', message} if anything throws. Posts {type:'ready'} once the
 * script itself has loaded, so the RN side knows it's safe to postMessage a
 * job (there is no listener until then).
 */
const CROP_WEBVIEW_HTML = `<!DOCTYPE html><html><body style="margin:0">
<script>
function post(obj) {
  window.ReactNativeWebView.postMessage(JSON.stringify(obj));
}
function onCropMessage(raw) {
  var msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (!msg || msg.type !== 'crop') return;
  var img = new Image();
  img.onload = function () {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = msg.outputWidth;
      canvas.height = msg.outputHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        msg.crop.x, msg.crop.y, msg.crop.width, msg.crop.height,
        0, 0, msg.outputWidth, msg.outputHeight
      );
      post({ type: 'result', dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    } catch (err) {
      post({ type: 'error', message: 'canvas: ' + String(err) });
    }
  };
  img.onerror = function () {
    post({ type: 'error', message: 'Could not decode the source image in the WebView.' });
  };
  img.src = msg.dataUri;
}
document.addEventListener('message', function (e) { onCropMessage(e.data); });
window.addEventListener('message', function (e) { onCropMessage(e.data); });
post({ type: 'ready' });
</script>
</body></html>`;

function guessMimeType(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase().split('?')[0];
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

const MAX_ZOOM = 4;
const FRAME_MARGIN = spacing.xl * 2;

interface ImageCropModalProps {
  visible: boolean;
  /** The raw, un-cropped image URI (e.g. straight from expo-image-picker). */
  imageUri: string | null;
  /**
   * The picked file's real pixel dimensions, straight from
   * expo-image-picker's own asset (`asset.width`/`asset.height`) —
   * PREFERRED over probing the file ourselves. `Image.getSize()` is
   * unreliable for some Android `content://` URIs (it can resolve to a
   * tiny placeholder size instead of the real decoded image), which made
   * the crop frame zoom in by a huge, wrong factor and show a
   * blown-up/pixelated few-pixel patch instead of the photo. When this is
   * omitted (null/undefined), falls back to Image.getSize as a best effort.
   */
  initialSize?: { width: number; height: number } | null;
  /** width / height, e.g. 1 for a square teacher photo, 16/9 for a chapter cover. */
  aspectRatio: number;
  title?: string;
  onCancel: () => void;
  /** Called with the local URI of the final cropped JPEG. */
  onDone: (croppedUri: string) => void;
}

export function ImageCropModal({ visible, imageUri, initialSize, aspectRatio, title, onCancel, onDone }: ImageCropModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const frameWidth = Math.min(windowWidth - FRAME_MARGIN, 480);
  const frameHeight = Math.min(frameWidth / aspectRatio, windowHeight * 0.6);
  const effectiveFrameWidth = frameHeight * aspectRatio; // in case height was the limiting side

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  // --- hidden-WebView crop engine (see CROP_WEBVIEW_HTML above) ---------
  type CropJob = {
    dataUri: string;
    crop: { x: number; y: number; width: number; height: number };
    outputWidth: number;
    outputHeight: number;
  };
  const [cropJob, setCropJob] = useState<CropJob | null>(null);
  const cropJobIdRef = useRef(0);
  const cropSettleRef = useRef<{ resolve: (dataUrl: string) => void; reject: (e: Error) => void } | null>(null);
  const webviewRef = useRef<WebView>(null);

  /** Runs one crop job through the hidden WebView and resolves with a
   * "data:image/jpeg;base64,..." URL. Only one job at a time — handleDone
   * already guards against overlapping calls via the `processing` state. */
  const cropViaWebView = (job: CropJob): Promise<string> =>
    new Promise((resolve, reject) => {
      cropJobIdRef.current += 1;
      cropSettleRef.current = { resolve, reject };
      setCropJob(job);
    });

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    setCropError(null);
    if (!imageUri) {
      setNaturalSize(null);
      return undefined;
    }

    const applySize = (w: number, h: number, source: string) => {
      // eslint-disable-next-line no-console
      console.log('ImageCropModal naturalSize:', { source, width: w, height: h, imageUri });
      setNaturalSize({ width: w, height: h });
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    };

    // Prefer the picker's own reported dimensions — see the initialSize
    // prop's doc comment for why Image.getSize() alone isn't trustworthy
    // here. Only fall back to probing the file when the caller didn't pass
    // them (e.g. a future call site that only has a bare URI).
    if (initialSize && initialSize.width > 0 && initialSize.height > 0) {
      applySize(initialSize.width, initialSize.height, 'initialSize prop');
      return undefined;
    }

    let cancelled = false;
    Image.getSize(
      imageUri,
      (w, h) => {
        if (!cancelled) applySize(w, h, 'Image.getSize fallback');
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.log('ImageCropModal Image.getSize failed:', err);
        if (!cancelled) setNaturalSize(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUri, initialSize]);

  const baseScale = naturalSize
    ? Math.max(effectiveFrameWidth / naturalSize.width, frameHeight / naturalSize.height)
    : 1;
  const naturalWidth = naturalSize?.width ?? 1;
  const naturalHeight = naturalSize?.height ?? 1;

  useEffect(() => {
    if (!naturalSize) return;
    // eslint-disable-next-line no-console
    console.log('ImageCropModal layout:', {
      naturalSize,
      frame: { width: effectiveFrameWidth, height: frameHeight },
      baseScale,
      displaySize: { width: naturalWidth * baseScale, height: naturalHeight * baseScale },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize, effectiveFrameWidth, frameHeight]);

  const clampTranslation = (value: number, dispSize: number, frameSize: number) => {
    'worklet';
    const half = Math.max((dispSize - frameSize) / 2, 0);
    return Math.min(Math.max(value, -half), half);
  };

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const dispW = naturalWidth * baseScale * scale.value;
      const dispH = naturalHeight * baseScale * scale.value;
      translateX.value = clampTranslation(savedTranslateX.value + e.translationX, dispW, effectiveFrameWidth);
      translateY.value = clampTranslation(savedTranslateY.value + e.translationY, dispH, frameHeight);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_ZOOM);
      scale.value = next;
      const dispW = naturalWidth * baseScale * next;
      const dispH = naturalHeight * baseScale * next;
      translateX.value = clampTranslation(translateX.value, dispW, effectiveFrameWidth);
      translateY.value = clampTranslation(translateY.value, dispH, frameHeight);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  // Width/height are deliberately a PLAIN (non-animated) style object, kept
  // separate from the animated transform below — confirmed by testing that
  // routing width/height through useAnimatedStyle (even though their VALUE
  // doesn't change per gesture frame) made the image render visibly
  // blurry/pixelated on Android: reanimated applies useAnimatedStyle
  // properties via its own UI-thread prop-write path rather than React
  // Native's normal style/layout pipeline, and Image's native bitmap decode
  // on Android depends on that normal pipeline to size itself correctly.
  // Only translateX/Y/scale actually change per frame, so only those need
  // to be animated — a GPU transform on an already correctly-decoded
  // full-size bitmap stays sharp at any zoom level.
  const imageBaseStyle = { width: naturalWidth * baseScale, height: naturalHeight * baseScale };
  const imageTransformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleReset = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const handleDone = async () => {
    if (!imageUri || !naturalSize) return;
    setProcessing(true);
    setCropError(null);
    try {
      const totalScale = baseScale * scale.value;
      const dispW = naturalWidth * totalScale;
      const dispH = naturalHeight * totalScale;
      const left = (effectiveFrameWidth - dispW) / 2 + translateX.value;
      const top = (frameHeight - dispH) / 2 + translateY.value;

      const cropWidth = effectiveFrameWidth / totalScale;
      const cropHeight = frameHeight / totalScale;
      let originX = -left / totalScale;
      let originY = -top / totalScale;

      // Floating-point safety: keep the crop rect fully inside the source
      // image regardless of tiny rounding drift from the gesture math above.
      originX = Math.min(Math.max(originX, 0), naturalWidth - cropWidth);
      originY = Math.min(Math.max(originY, 0), naturalHeight - cropHeight);

      // Read the source file and hand it to the hidden WebView as a data:
      // URI — see the top-of-file comment for why cropping runs there
      // (through <canvas>) instead of through a native module.
      const base64Source = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUri = `data:${guessMimeType(imageUri)};base64,${base64Source}`;

      const resultDataUrl = await cropViaWebView({
        dataUri,
        crop: {
          x: Math.round(originX),
          y: Math.round(originY),
          width: Math.round(cropWidth),
          height: Math.round(cropHeight),
        },
        outputWidth: Math.round(cropWidth),
        outputHeight: Math.round(cropHeight),
      });

      const base64Result = resultDataUrl.split(',')[1] ?? '';
      const outPath = `${FileSystem.cacheDirectory}crop-${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(outPath, base64Result, {
        encoding: FileSystem.EncodingType.Base64,
      });
      onDone(outPath);
    } catch (e) {
      setCropError(e instanceof Error ? e.message : 'Could not process this photo.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.overlay}>
        <View style={styles.card}>
          {title ? <Text style={styles.title}>{title}</Text> : null}

          <View style={[styles.frame, { width: effectiveFrameWidth, height: frameHeight }]}>
            {naturalSize ? (
              <GestureDetector gesture={composedGesture}>
                <Animated.View style={[StyleSheet.absoluteFill, styles.centerContent]}>
                  {imageUri ? (
                    <Animated.Image
                      source={{ uri: imageUri }}
                      style={[imageBaseStyle, imageTransformStyle]}
                      resizeMode="cover"
                    />
                  ) : null}
                </Animated.View>
              </GestureDetector>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>

          <Text style={styles.hint}>Drag to move, pinch with two fingers to zoom</Text>
          {cropError ? <Text style={styles.errorText}>{cropError}</Text> : null}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleReset} disabled={processing}>
              <Text style={styles.secondaryButtonText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} disabled={processing}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, (!naturalSize || processing) && styles.buttonDisabled]}
              onPress={handleDone}
              disabled={!naturalSize || processing}
            >
              {processing ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Done</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Invisible — this WebView is a crop ENGINE (canvas), not UI. Only
            mounted while a crop job is in flight; see cropViaWebView above. */}
        {cropJob ? (
          <WebView
            key={cropJobIdRef.current}
            style={styles.hiddenWebView}
            originWhitelist={['*']}
            source={{ html: CROP_WEBVIEW_HTML }}
            onMessage={(event) => {
              let msg: { type: string; dataUrl?: string; message?: string };
              try {
                msg = JSON.parse(event.nativeEvent.data);
              } catch {
                return;
              }
              if (msg.type === 'ready') {
                // The page just finished loading its script — safe to post
                // the actual job now (nothing was listening before this).
                webviewRef.current?.postMessage(
                  JSON.stringify({ type: 'crop', ...cropJob }),
                );
              } else if (msg.type === 'result' && msg.dataUrl) {
                cropSettleRef.current?.resolve(msg.dataUrl);
                cropSettleRef.current = null;
                setCropJob(null);
              } else if (msg.type === 'error') {
                cropSettleRef.current?.reject(new Error(msg.message ?? 'Crop failed in WebView.'));
                cropSettleRef.current = null;
                setCropJob(null);
              }
            }}
            onError={() => {
              cropSettleRef.current?.reject(new Error('The crop engine (WebView) failed to load.'));
              cropSettleRef.current = null;
              setCropJob(null);
            }}
            ref={webviewRef}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5,7,12,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  frame: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centers the (base-scale-sized, pre-transform) image within the frame —
  // the baseline that translateX/Y == 0 and scale == 1 lands on, and the
  // origin all of ImageCropModal's crop math above is measured from.
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '500',
  },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Not visually hidden via opacity/display — some Android WebView builds
  // pause JS execution for a 0-opacity or display:none WebView. Parking it
  // off-screen at a tiny size keeps it actually running.
  hiddenWebView: {
    position: 'absolute',
    top: -1000,
    left: 0,
    width: 2,
    height: 2,
  },
});
