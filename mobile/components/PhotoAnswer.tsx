import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ImageViewerModal } from '@/components/ImageViewerModal';
import { ApiError, uploadExamAnswerPhoto } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';

const STRINGS = {
  ar: {
    hint: 'حل السؤال على ورقة بالخطوات، وبعدين صوّر الحل كله صورة واضحة.',
    camera: 'صوّر الحل',
    gallery: 'اختار من الصور',
    retake: 'صوّر تاني',
    remove: 'شيل الصورة',
    uploading: (p: number) => `بيترفع... ${p}%`,
    saved: 'الصورة اترفعت ✓',
    tapToZoom: 'دوس على الصورة عشان تكبّرها',
    permTitle: 'محتاجين إذن',
    permCamera: 'اسمح للتطبيق يستخدم الكاميرا عشان تصوّر الحل.',
    permGallery: 'اسمح للتطبيق يوصل للصور عشان تختار صورة الحل.',
    failed: 'الصورة ماترفعتش. اتأكد من النت وجرّب تاني.',
  },
  en: {
    hint: 'Solve it on paper with all your steps, then take one clear photo of the whole solution.',
    camera: 'Take photo',
    gallery: 'Choose photo',
    retake: 'Retake',
    remove: 'Remove',
    uploading: (p: number) => `Uploading... ${p}%`,
    saved: 'Photo uploaded ✓',
    tapToZoom: 'Tap the photo to zoom',
    permTitle: 'Permission needed',
    permCamera: 'Allow camera access to photograph your solution.',
    permGallery: 'Allow photo access to pick your solution photo.',
    failed: "The photo didn't upload. Check your connection and try again.",
  },
};

/**
 * Answer box for an essay question: the student solves on paper and sends a
 * photo. Uploads straight to storage (see uploadExamAnswerPhoto) and hands
 * the stored reference back via onChange, which becomes the answer.
 */
export function PhotoAnswer({
  attemptId,
  questionId,
  value,
  previewUri,
  language,
  onChange,
}: {
  attemptId: string;
  questionId: string;
  /** The current answer: a stored photo reference, or '' when none. */
  value: string;
  /** Something displayable for the current photo (local file or signed link). */
  previewUri: string | null;
  language: 'ar' | 'en';
  onChange: (answer: string, previewUri: string | null) => void;
}) {
  const t = STRINGS[language];
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const hasPhoto = value.startsWith('b2:');

  const pick = async (source: 'camera' | 'gallery') => {
    setError(null);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.permTitle, source === 'camera' ? t.permCamera : t.permGallery);
      return;
    }
    // quality 0.6 keeps handwriting sharp while the upload stays small.
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];

    setProgress(0);
    try {
      const fileUrl = await uploadExamAnswerPhoto(attemptId, questionId, asset.uri, 'answer.jpg', (f) =>
        setProgress(Math.round(f * 100)),
      );
      onChange(fileUrl, asset.uri);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : t.failed);
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {hasPhoto ? (
        <Animated.View entering={FadeIn.duration(250)}>
          {previewUri ? (
            <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel={t.tapToZoom}>
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
              <View style={styles.zoomHint}>
                <Ionicons name="expand-outline" size={13} color={colors.text} />
                <Text style={styles.zoomHintText}>{t.tapToZoom}</Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.savedBox}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.savedText}>{t.saved}</Text>
            </View>
          )}
          <View style={styles.row}>
            <ActionButton icon="camera-outline" label={t.retake} onPress={() => pick('camera')} disabled={progress != null} />
            <ActionButton icon="images-outline" label={t.gallery} onPress={() => pick('gallery')} disabled={progress != null} />
            <ActionButton icon="trash-outline" label={t.remove} tone="danger" onPress={() => onChange('', null)} disabled={progress != null} />
          </View>
        </Animated.View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={30} color={colors.primary} />
          <Text style={styles.hint}>{t.hint}</Text>
          <View style={styles.row}>
            <ActionButton icon="camera" label={t.camera} primary onPress={() => pick('camera')} disabled={progress != null} />
            <ActionButton icon="images-outline" label={t.gallery} onPress={() => pick('gallery')} disabled={progress != null} />
          </View>
        </View>
      )}

      {progress != null ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>{t.uploading(progress)}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ImageViewerModal visible={zoom} url={previewUri} onClose={() => setZoom(false)} />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  primary,
  tone,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
  tone?: 'danger';
  disabled?: boolean;
}) {
  const color = primary ? colors.onPrimary : tone === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, primary && styles.buttonPrimary, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: spacing.sm },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `${colors.primary}66`,
    backgroundColor: `${colors.primary}0D`,
  },
  hint: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    minHeight: 44,
  },
  buttonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { fontFamily: fonts.semiBold, fontSize: 13.5 },
  preview: { width: '100%', aspectRatio: 0.8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  zoomHint: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#000000AA',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  zoomHintText: { color: colors.text, fontFamily: fonts.medium, fontSize: 11.5 },
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: `${colors.success}14`,
  },
  savedText: { color: colors.success, fontFamily: fonts.semiBold, fontSize: 14 },
  progressWrap: { gap: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  progressText: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' },
  error: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12.5, textAlign: 'center' },
});
