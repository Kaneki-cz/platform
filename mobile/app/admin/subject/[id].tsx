import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ImageCropModal } from '@/components/ImageCropPicker';
import { ResolvedImage } from '@/components/ResolvedImage';
import {
  ApiError,
  createCourse,
  createTeacher,
  deleteCourse,
  deleteTeacher,
  getSubject,
  listTeachers,
  updateCourse,
  updateTeacher,
  uploadImage,
} from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import { GRADE_LEVELS, type GradeLevel, type SubjectDetail, type Teacher } from '@/lib/types';

// width/height come straight from the picker's own asset — see
// ImageCropModal's initialSize prop for why we pass these through instead
// of letting the crop tool re-probe the file itself.
type CropTarget = { kind: 'teacher' | 'cover'; rawUri: string; width: number; height: number } | null;

export default function ManageSubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<SubjectDetail | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  // --- Teacher form state ---------------------------------------------
  const [teacherEditingId, setTeacherEditingId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhotoUrl, setTeacherPhotoUrl] = useState<string | null>(null); // uploaded b2:/http url, ready to save
  const [teacherPhotoPreview, setTeacherPhotoPreview] = useState<string | null>(null); // local file, just-cropped
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);

  // --- Chapter form state -----------------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gradeLevel, setGradeLevel] = useState<GradeLevel | null>(null);
  const [chapterTeacherId, setChapterTeacherId] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropTarget, setCropTarget] = useState<CropTarget>(null);

  const load = useCallback(() => {
    if (!id) return;
    getSubject(id).then(setSubject).catch(() => {});
    listTeachers(id).then(setTeachers).catch(() => {});
  }, [id]);

  useFocusEffect(load);

  // --- Photo picking (shared by teacher photo + chapter cover) ----------
  const pickRawImage = async (kind: 'teacher' | 'cover') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      const setErr = kind === 'teacher' ? setTeacherError : setError;
      setErr('Photo library permission is required to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    // eslint-disable-next-line no-console
    console.log('Picked image asset:', {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType,
    });
    setCropTarget({ kind, rawUri: asset.uri, width: asset.width, height: asset.height });
  };

  const onCropDone = async (croppedUri: string) => {
    const kind = cropTarget?.kind;
    setCropTarget(null);
    if (!kind) return;
    setUploadingPhoto(true);
    try {
      const url = await uploadImage(croppedUri, `${kind}-${Date.now()}.jpg`, 'image/jpeg');
      if (kind === 'teacher') {
        setTeacherPhotoUrl(url);
        setTeacherPhotoPreview(croppedUri);
      } else {
        setCoverImageUrl(url);
        setCoverPreview(croppedUri);
      }
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      const setErr = kind === 'teacher' ? setTeacherError : setError;
      setErr(`Photo upload failed: ${detail}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  // --- Teachers -----------------------------------------------------------
  const resetTeacherForm = () => {
    setTeacherEditingId(null);
    setTeacherName('');
    setTeacherPhotoUrl(null);
    setTeacherPhotoPreview(null);
    setTeacherError(null);
  };

  const onEditTeacher = (teacher: Teacher) => {
    setTeacherEditingId(teacher.id);
    setTeacherName(teacher.name);
    setTeacherPhotoUrl(teacher.photo_url);
    setTeacherPhotoPreview(null);
    setTeacherError(null);
    // Tapping a teacher card also scopes the Chapters section below to just
    // their chapters (see visibleCourses) — and, as long as we're not in the
    // middle of editing some other chapter already, pre-selects them in the
    // "Add a chapter" teacher chip too, so a new chapter defaults to the
    // teacher you're currently looking at instead of landing unassigned.
    if (!editingId) setChapterTeacherId(teacher.id);
  };

  const onSubmitTeacher = async () => {
    if (!id || !teacherName.trim()) return;
    setTeacherError(null);
    setTeacherSubmitting(true);
    try {
      if (teacherEditingId) {
        await updateTeacher(teacherEditingId, {
          name: teacherName.trim(),
          photo_url: teacherPhotoUrl ?? undefined,
        });
      } else {
        await createTeacher({ subject_id: id, name: teacherName.trim(), photo_url: teacherPhotoUrl ?? undefined });
      }
      resetTeacherForm();
      load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Add/save teacher failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
      setTeacherError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setTeacherSubmitting(false);
    }
  };

  const onDeleteTeacher = (teacherId: string, name: string) => {
    Alert.alert('Delete teacher?', `This removes "${name}"'s card. Chapters already assigned to them must be reassigned first.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTeacher(teacherId);
            if (teacherEditingId === teacherId) resetTeacherForm();
            load();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
          }
        },
      },
    ]);
  };

  // --- Chapters -----------------------------------------------------------
  const resetChapterForm = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setGradeLevel(null);
    setChapterTeacherId(null);
    setCoverImageUrl(null);
    setCoverPreview(null);
    setError(null);
  };

  const onEditChapter = (course: SubjectDetail['courses'][number]) => {
    setEditingId(course.id);
    setTitle(course.title);
    setDescription(course.description ?? '');
    setGradeLevel((course.grade_level as GradeLevel | null) ?? null);
    setChapterTeacherId(course.teacher_id);
    setCoverImageUrl(course.cover_image_url);
    setCoverPreview(null);
    setError(null);
  };

  const onSubmitChapter = async () => {
    if (!id || !title.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        await updateCourse(editingId, {
          title: title.trim(),
          description: description.trim() || undefined,
          grade_level: gradeLevel ?? undefined,
          teacher_id: chapterTeacherId,
          cover_image_url: coverImageUrl ?? undefined,
        });
      } else {
        await createCourse({
          subject_id: id,
          title: title.trim(),
          description: description.trim() || undefined,
          grade_level: gradeLevel ?? undefined,
          teacher_id: chapterTeacherId ?? undefined,
          cover_image_url: coverImageUrl ?? undefined,
        });
      }
      resetChapterForm();
      load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Add/save chapter failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const onDeleteChapter = (courseId: string, chapterTitle: string) => {
    Alert.alert(
      'Delete chapter?',
      `This will permanently delete "${chapterTitle}" and every lecture inside it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCourse(courseId);
              if (editingId === courseId) resetChapterForm();
              load();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
            }
          },
        },
      ],
    );
  };

  if (!subject) return null;

  // Scope the Chapters grid to whichever teacher card is currently
  // selected/edited above — without this every chapter for the whole
  // subject showed in one flat list no matter which teacher you tapped,
  // which is what made a just-added chapter hard to find once a subject
  // had more than a couple of teachers.
  const filterTeacher = teacherEditingId ? teachers.find((t) => t.id === teacherEditingId) : null;
  const visibleCourses = filterTeacher
    ? subject.courses.filter((c) => c.teacher_id === filterTeacher.id)
    : subject.courses;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.xl }}>
      <Text style={styles.title}>{subject.name}</Text>

      {/* --- Teachers ------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Teachers</Text>
      <View style={styles.cardGrid}>
        {teachers.map((teacher) => (
          <Pressable
            key={teacher.id}
            style={[styles.teacherCard, teacherEditingId === teacher.id && styles.cardEditing]}
            onPress={() => onEditTeacher(teacher)}
          >
            <ResolvedImage
              url={teacher.photo_url}
              style={styles.teacherPhoto}
              containerStyle={styles.teacherPhoto}
              fallback={<View style={[styles.teacherPhoto, styles.photoPlaceholder]}><Text style={styles.photoPlaceholderText}>👤</Text></View>}
            />
            <Text style={styles.cardName} numberOfLines={1}>{teacher.name}</Text>
            <Pressable onPress={() => onDeleteTeacher(teacher.id, teacher.name)} hitSlop={8}>
              <Text style={styles.removeText}>Delete</Text>
            </Pressable>
          </Pressable>
        ))}
        {teachers.length === 0 ? <Text style={styles.empty}>No teachers yet — add one below.</Text> : null}
      </View>

      <Text style={styles.label}>{teacherEditingId ? 'Editing teacher — tap another one to switch' : 'Add a teacher'}</Text>
      <TextInput
        style={styles.input}
        placeholder="Teacher name"
        placeholderTextColor="#9ca3af"
        value={teacherName}
        onChangeText={setTeacherName}
      />
      <PhotoPicker
        previewUri={teacherPhotoPreview}
        existingUrl={teacherPhotoUrl}
        uploading={uploadingPhoto}
        label="Teacher photo"
        onPick={() => pickRawImage('teacher')}
        style={styles.teacherPhotoPicker}
      />
      {teacherError ? <Text style={styles.error}>{teacherError}</Text> : null}
      <View style={styles.formActions}>
        {teacherEditingId ? (
          <Pressable style={styles.cancelButton} onPress={resetTeacherForm}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.button, styles.formActionsButton]} onPress={onSubmitTeacher} disabled={teacherSubmitting}>
          {teacherSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{teacherEditingId ? 'Save Teacher' : 'Add Teacher'}</Text>
          )}
        </Pressable>
      </View>

      {/* --- Chapters --------------------------------------------------- */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{filterTeacher ? `Chapters — ${filterTeacher.name}` : 'Chapters'}</Text>
        {filterTeacher ? (
          <Pressable onPress={resetTeacherForm} hitSlop={8}>
            <Text style={styles.clearFilterText}>Show all</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.cardGrid}>
        {visibleCourses.map((course, index) => (
          <Pressable
            key={course.id}
            style={[styles.chapterCard, editingId === course.id && styles.cardEditing]}
            onPress={() => onEditChapter(course)}
          >
            <ResolvedImage
              url={course.cover_image_url}
              style={styles.chapterCover}
              containerStyle={styles.chapterCover}
              fallback={<View style={[styles.chapterCover, styles.photoPlaceholder]}><Text style={styles.photoPlaceholderText}>📘</Text></View>}
            />
            <Text style={styles.cardName} numberOfLines={2}>
              {index + 1}. {course.title}
            </Text>
            {course.grade_level ? <Text style={styles.cardMeta} numberOfLines={1}>{course.grade_level}</Text> : null}
            <View style={styles.chapterCardActions}>
              <Pressable onPress={() => router.push(`/admin/course/${course.id}`)} hitSlop={8}>
                <Text style={styles.quizLinkText}>Lectures</Text>
              </Pressable>
              <Pressable onPress={() => onDeleteChapter(course.id, course.title)} hitSlop={8}>
                <Text style={styles.removeText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
        {visibleCourses.length === 0 ? (
          <Text style={styles.empty}>
            {filterTeacher ? `No chapters for ${filterTeacher.name} yet — add one below.` : 'No chapters yet — add one below.'}
          </Text>
        ) : null}
      </View>

      <Text style={styles.label}>{editingId ? 'Editing chapter — tap another one to switch' : 'Add a chapter'}</Text>
      <TextInput
        style={styles.input}
        placeholder="Chapter title, e.g. الفصل الأول: التيار الكهربي"
        placeholderTextColor="#9ca3af"
        value={title}
        onChangeText={setTitle}
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

      <Text style={styles.label}>Teacher</Text>
      <View style={styles.chipRow}>
        {teachers.map((t) => (
          <Pressable
            key={t.id}
            style={[styles.chip, chapterTeacherId === t.id && styles.chipSelected]}
            onPress={() => setChapterTeacherId(chapterTeacherId === t.id ? null : t.id)}
          >
            <Text style={[styles.chipText, chapterTeacherId === t.id && styles.chipTextSelected]}>{t.name}</Text>
          </Pressable>
        ))}
        {teachers.length === 0 ? <Text style={styles.hint}>Add a teacher above first.</Text> : null}
      </View>

      <PhotoPicker
        previewUri={coverPreview}
        existingUrl={coverImageUrl}
        uploading={uploadingPhoto}
        label="Cover image"
        onPick={() => pickRawImage('cover')}
        style={styles.coverPicker}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.formActions}>
        {editingId ? (
          <Pressable style={styles.cancelButton} onPress={resetChapterForm}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.button, styles.formActionsButton]} onPress={onSubmitChapter} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{editingId ? 'Save Chapter' : 'Add Chapter'}</Text>}
        </Pressable>
      </View>

      <ImageCropModal
        visible={cropTarget !== null}
        imageUri={cropTarget?.rawUri ?? null}
        initialSize={cropTarget ? { width: cropTarget.width, height: cropTarget.height } : null}
        aspectRatio={cropTarget?.kind === 'teacher' ? 1 : 16 / 9}
        title={cropTarget?.kind === 'teacher' ? 'Crop teacher photo' : 'Crop cover image'}
        onCancel={() => setCropTarget(null)}
        onDone={onCropDone}
      />
    </ScrollView>
  );
}

/** Small shared "tap to pick/replace a photo" control used for both the
 * teacher-photo and chapter-cover fields — shows the just-cropped local
 * preview if there is one, else the already-saved photo (resolved through
 * ResolvedImage), else a dashed placeholder. */
function PhotoPicker({
  previewUri,
  existingUrl,
  uploading,
  label,
  onPick,
  style,
}: {
  previewUri: string | null;
  existingUrl: string | null;
  uploading: boolean;
  label: string;
  onPick: () => void;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable style={[styles.photoPickerButton, style]} onPress={onPick} disabled={uploading}>
      {uploading ? (
        <ActivityIndicator color={colors.primary} />
      ) : previewUri ? (
        <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : existingUrl ? (
        <ResolvedImage url={existingUrl} style={StyleSheet.absoluteFill} containerStyle={StyleSheet.absoluteFill} />
      ) : (
        <Text style={styles.photoPickerText}>📤 {label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm, color: colors.text },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearFilterText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  teacherCard: {
    width: 96,
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chapterCard: {
    width: 150,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardEditing: { borderColor: colors.primary },
  teacherPhoto: { width: 64, height: 64, borderRadius: radius.pill, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt },
  chapterCover: { width: '100%', height: 84, borderRadius: radius.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { fontSize: 22 },
  cardName: { fontSize: 13, fontWeight: '600', color: colors.text, textAlign: 'center' },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  chapterCardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  removeText: { color: colors.danger, fontWeight: '600', fontSize: 12 },
  quizLinkText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  empty: { color: colors.textFaint, marginVertical: 20 },
  label: { fontSize: 14, color: colors.textMuted, marginTop: 16, marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.textFaint },
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
  },
  teacherPhotoPicker: { width: 96, height: 96, borderRadius: radius.pill, alignSelf: 'flex-start' },
  coverPicker: { width: '100%', height: 120 },
  photoPickerText: { color: colors.primary, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.sm },
  formActions: { flexDirection: 'row', gap: 10, marginBottom: 20, marginTop: spacing.sm },
  formActionsButton: { flex: 1, marginBottom: 0 },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  cancelButtonText: { color: colors.textMuted, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 20 },
  buttonText: { color: colors.onPrimary, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 10 },
});
