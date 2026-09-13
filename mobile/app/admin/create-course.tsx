import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ImageCropModal } from '@/components/ImageCropPicker';
import { ResolvedImage } from '@/components/ResolvedImage';
import { ApiError, createCourse, uploadImage } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import { GRADE_LEVELS, type GradeLevel } from '@/lib/types';

type RawImage = { rawUri: string; width: number; height: number } | null;

/** Lets an instructor add a new chapter under their own linked teacher card.
 * No subject/teacher picker here — unlike the admin "Add a chapter" form
 * inside app/admin/subject/[id].tsx — because the server derives both from
 * whichever TeacherProfile the signed-in instructor's account is linked to
 * (see backend/app/api/routes/courses.py's create_course: an instructor's
 * subject_id/teacher_id in the request body are ignored and replaced with
 * their own linked profile's values; an admin still can't reach this screen
 * at all, since app/admin/index.tsx only offers it in the instructor
 * branch — an admin keeps creating chapters from inside a subject, where
 * subject/teacher context already exists). */
export default function CreateCourseScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gradeLevel, setGradeLevel] = useState<GradeLevel | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [rawImage, setRawImage] = useState<RawImage>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickCover = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is required to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setRawImage({ rawUri: asset.uri, width: asset.width, height: asset.height });
  };

  const onCropDone = async (croppedUri: string) => {
    setRawImage(null);
    setUploadingPhoto(true);
    try {
      const url = await uploadImage(croppedUri, `chapter-cover-${Date.now()}.jpg`, 'image/jpeg');
      setCoverImageUrl(url);
      setCoverPreview(croppedUri);
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(`Photo upload failed: ${detail}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const onSubmit = async () => {
    if (!title.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await createCourse({
        title: title.trim(),
        description: description.trim() || undefined,
        grade_level: gradeLevel ?? undefined,
        cover_image_url: coverImageUrl ?? undefined,
      });
      router.back();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Create chapter failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.xl }}>
      <Text style={styles.label}>Chapter title</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. الفصل الأول: التيار الكهربي"
        placeholderTextColor="#9ca3af"
        value={title}
        onChangeText={setTitle}
        autoFocus
      />
      <TextInput
        style={styles.input}
        placeholder="Description (optional)"
        placeholderTextColor="#9ca3af"
        value={description}
        onChangeText={setDescription}
      />

      <Text style={styles.label}>Grade level</Text>
      <View style={styles.chipRow}>
        {GRADE_LEVELS.map((g) => (
          <Pressable
            key={g}
            style={[styles.chip, gradeLevel === g && styles.chipSelected]}
            onPress={() => setGradeLevel(gradeLevel === g ? null : g)}
          >
            <Text style={[styles.chipText, gradeLevel === g && styles.chipTextSelected]}>{g}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Cover image (optional)</Text>
      <Pressable style={styles.photoPickerButton} onPress={pickCover} disabled={uploadingPhoto}>
        {uploadingPhoto ? (
          <ActivityIndicator color={colors.primary} />
        ) : coverPreview ? (
          <Image source={{ uri: coverPreview }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : coverImageUrl ? (
          <ResolvedImage url={coverImageUrl} style={StyleSheet.absoluteFill} containerStyle={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.photoPickerText}>📤 Cover image</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Add Chapter</Text>}
      </Pressable>

      <ImageCropModal
        visible={rawImage !== null}
        imageUri={rawImage?.rawUri ?? null}
        initialSize={rawImage ? { width: rawImage.width, height: rawImage.height } : null}
        aspectRatio={16 / 9}
        title="Crop cover image"
        onCancel={() => setRawImage(null)}
        onDone={onCropDone}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { fontSize: 14, color: colors.textMuted, marginTop: 16, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '1f' },
  chipText: { color: colors.textMuted, fontSize: 13 },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
  photoPickerButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: 10,
    overflow: 'hidden',
    width: '100%',
    height: 120,
  },
  photoPickerText: { color: colors.primary, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 10 },
});
