import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ImageCropModal } from '@/components/ImageCropPicker';
import { ResolvedImage } from '@/components/ResolvedImage';
import {
  ApiError,
  createLesson,
  deleteLesson,
  deleteLessonCode,
  discardUnsavedUpload,
  generateLessonCodes,
  getCourse,
  getLesson,
  listCourseExams,
  listLessonCodes,
  updateLesson,
  uploadImage,
  uploadVideo,
} from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { CourseDetail, LessonAccessCode } from '@/lib/types';

// Cover picked straight from expo-image-picker, awaiting crop — see
// ImageCropModal's initialSize prop for why width/height are carried through
// from the picker's own asset instead of re-probed later.
type CoverCropTarget = { rawUri: string; width: number; height: number } | null;

// Same lazily-guarded require as app/(tabs)/assistant.tsx's copy button —
// expo-clipboard needs its native module compiled into the app binary, so a
// plain top-level import would crash this whole screen on a build that
// predates adding the dependency. Degrades to "Copy" quietly doing nothing
// useful on such a build instead.
let ClipboardModule: typeof import('expo-clipboard') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ClipboardModule = require('expo-clipboard');
} catch {
  ClipboardModule = null;
}

export default function ManageCourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  // What's actually saved for this lecture right now (the lesson's real
  // video_url from the server, or '' while adding a brand-new one) — vs
  // `videoUrl` above, which also tracks whatever was just uploaded in this
  // editing session but not saved yet. Whenever those two differ AND the
  // current `videoUrl` is a "b2:<key>" upload, that upload has nothing in
  // the database pointing at it — see discardIfUnsaved below, which is
  // what stops an upload the admin backs out of (or replaces with another
  // upload before saving) from sitting in R2 forever.
  const [originalVideoUrl, setOriginalVideoUrl] = useState('');
  // Same "unsaved upload" bookkeeping as video above, for the lecture's
  // optional poster-style cover image (Lesson.cover_image_url) — lets the
  // chapter screen show lectures the same way it shows chapters. `coverImageUrl`
  // is what gets saved; `coverImagePreview` is the just-cropped local file
  // shown while it's still uploading/before a save.
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [originalCoverImageUrl, setOriginalCoverImageUrl] = useState<string | null>(null);
  const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
  const [coverCropTarget, setCoverCropTarget] = useState<CoverCropTarget>(null);
  const [content, setContent] = useState('');
  // String, not number, so the field can sit empty (= unlimited) instead of
  // defaulting to 0 — see the max_views comment on Lesson in the backend.
  const [maxViews, setMaxViews] = useState('');
  // Escape hatch from the standalone-exam gate below — see
  // Lesson.exempt_from_exam_gate. Irrelevant (but harmless) for a chapter
  // with no exams at all.
  const [exemptFromExamGate, setExemptFromExamGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 0..1, real bytes-sent-so-far fraction reported by the native upload
  // task (see lib/api.ts's uploadVideo) — not a fake/indeterminate spinner.
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loadingLesson, setLoadingLesson] = useState(false);
  // Redemption codes for whichever lecture is being edited — only
  // meaningful once editingId is set (a brand-new, not-yet-saved lecture has
  // no id to generate codes against yet). See lib/types.ts's
  // LessonAccessCode and the "Access codes" panel in the footer below.
  const [codes, setCodes] = useState<LessonAccessCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [generateCount, setGenerateCount] = useState('10');
  const [generating, setGenerating] = useState(false);

  // Standalone exams now live on their own screen
  // (app/admin/course/[id]/exams.tsx) — this screen only needs the COUNT,
  // for the "Manage Exams" nav card's subtitle below and to decide whether
  // the "skip the exam gate" switch (further down) is even relevant for
  // this chapter.
  const [examsCount, setExamsCount] = useState(0);

  const loadCodes = useCallback((lessonId: string) => {
    setCodesLoading(true);
    listLessonCodes(lessonId)
      .then(setCodes)
      .catch(() => setCodes([]))
      .finally(() => setCodesLoading(false));
  }, []);

  const load = useCallback(() => {
    if (!id) return;
    getCourse(id).then(setCourse).catch(() => {});
    listCourseExams(id)
      .then((list) => setExamsCount(list.length))
      .catch(() => setExamsCount(0));
  }, [id]);

  /** Deletes whatever's currently in `videoUrl` from R2 if — and only if —
   * it's an upload from this editing session that never actually got
   * saved (differs from `originalVideoUrl`, the lecture's real saved
   * value). Safe to call anytime something is about to discard/replace
   * the in-progress edit: right before a fresh upload, on Cancel, and
   * before switching to edit a different lecture. Never touches a video
   * that's actually attached to a lecture — deleting THAT one is the
   * backend's job the moment it's genuinely replaced/removed via Save or
   * Delete (see backend/app/api/routes/lessons.py). */
  const discardIfUnsaved = () => {
    if (videoUrl && videoUrl !== originalVideoUrl) {
      discardUnsavedUpload(videoUrl);
    }
    // Same logic, same reasoning, for the optional cover image.
    if (coverImageUrl && coverImageUrl !== originalCoverImageUrl) {
      discardUnsavedUpload(coverImageUrl);
    }
  };

  // Covers the gap none of the calls to discardIfUnsaved() elsewhere catch:
  // leaving this screen entirely (back button, switching tabs, closing the
  // app) with an uploaded-but-unsaved video still sitting in the form —
  // most easily hit while adding a brand-new lecture, since that mode has
  // no Cancel button to press (there's nothing "saved" to cancel back to).
  // Refs because an effect's cleanup only ever sees the values captured
  // when it first ran, not whatever the state holds by the time the
  // component actually unmounts — these two are kept current every render
  // so the unmount cleanup below always checks the latest values.
  const videoUrlRef = useRef(videoUrl);
  const originalVideoUrlRef = useRef(originalVideoUrl);
  const coverImageUrlRef = useRef(coverImageUrl);
  const originalCoverImageUrlRef = useRef(originalCoverImageUrl);
  useEffect(() => {
    videoUrlRef.current = videoUrl;
    originalVideoUrlRef.current = originalVideoUrl;
  }, [videoUrl, originalVideoUrl]);
  useEffect(() => {
    coverImageUrlRef.current = coverImageUrl;
    originalCoverImageUrlRef.current = originalCoverImageUrl;
  }, [coverImageUrl, originalCoverImageUrl]);
  useEffect(() => {
    return () => {
      const current = videoUrlRef.current;
      const original = originalVideoUrlRef.current;
      if (current && current !== original) {
        discardUnsavedUpload(current);
      }
      const currentCover = coverImageUrlRef.current;
      const originalCover = originalCoverImageUrlRef.current;
      if (currentCover && currentCover !== originalCover) {
        discardUnsavedUpload(currentCover);
      }
    };
  }, []);

  // --- Lecture cover image picking (poster art, same idea as a chapter's
  // own cover_image_url) ---------------------------------------------------
  const pickCoverImage = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is required to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    // Replacing whatever cover is currently sitting unsaved in the form —
    // clean it up first, same reasoning as discardIfUnsaved above.
    if (coverImageUrl && coverImageUrl !== originalCoverImageUrl) {
      discardUnsavedUpload(coverImageUrl);
    }
    const asset = result.assets[0];
    setCoverCropTarget({ rawUri: asset.uri, width: asset.width, height: asset.height });
  };

  const onCoverCropDone = async (croppedUri: string) => {
    setCoverCropTarget(null);
    setUploadingCoverImage(true);
    try {
      const url = await uploadImage(croppedUri, `lecture-cover-${Date.now()}.jpg`, 'image/jpeg');
      setCoverImageUrl(url);
      setCoverImagePreview(croppedUri);
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(`Cover image upload failed: ${detail}`);
    } finally {
      setUploadingCoverImage(false);
    }
  };

  const onPickVideo = async () => {
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo library permission is required to pick a video.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;

      // Uploading a replacement — whatever's currently sitting in
      // `videoUrl` is about to be thrown away. If that was itself an
      // earlier upload in this same session that was never saved, this is
      // the only chance to clean it up (see discardIfUnsaved's comment).
      discardIfUnsaved();

      const asset = result.assets[0];
      // eslint-disable-next-line no-console
      console.log('Picked video asset:', {
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });

      setUploading(true);
      setUploadProgress(0);
      const url = await uploadVideo(
        asset.uri,
        asset.fileName ?? `lecture-${Date.now()}.mp4`,
        asset.mimeType ?? 'video/mp4',
        setUploadProgress,
      );
      setVideoUrl(url);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Video upload failed:', e);
      const detail = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(`Video upload failed: ${detail}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  useFocusEffect(load);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setVideoUrl('');
    setOriginalVideoUrl('');
    setCoverImageUrl(null);
    setCoverImagePreview(null);
    setOriginalCoverImageUrl(null);
    setContent('');
    setMaxViews('');
    setExemptFromExamGate(false);
    setError(null);
    setCodes([]);
    setGenerateCount('10');
  };

  /** The Cancel button's handler — unlike resetForm() on its own (also used
   * right after a SUCCESSFUL save, when there's nothing to discard because
   * `videoUrl` just became the real saved value), this is a genuine
   * "throw away my edits" — including any not-yet-saved upload. */
  const onCancelEdit = () => {
    discardIfUnsaved();
    resetForm();
  };

  const onEditPress = async (lessonId: string) => {
    // Switching to a different lecture abandons whatever was in progress
    // on the current one — same as Cancel, so the same cleanup applies.
    discardIfUnsaved();
    setError(null);
    setLoadingLesson(true);
    try {
      const lesson = await getLesson(lessonId);
      setEditingId(lesson.id);
      setTitle(lesson.title);
      setVideoUrl(lesson.video_url ?? '');
      setOriginalVideoUrl(lesson.video_url ?? '');
      setCoverImageUrl(lesson.cover_image_url ?? null);
      setCoverImagePreview(null);
      setOriginalCoverImageUrl(lesson.cover_image_url ?? null);
      setContent(lesson.content ?? '');
      setMaxViews(lesson.max_views != null ? String(lesson.max_views) : '');
      setExemptFromExamGate(lesson.exempt_from_exam_gate);
      setGenerateCount('10');
      loadCodes(lesson.id);
    } catch {
      setError('Could not load this lecture. Please try again.');
    } finally {
      setLoadingLesson(false);
    }
  };

  const onGenerateCodes = async () => {
    if (!editingId || generating) return;
    const count = Number(generateCount.trim());
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      Alert.alert('Invalid amount', 'Enter a whole number between 1 and 500.');
      return;
    }
    setGenerating(true);
    try {
      await generateLessonCodes(editingId, count);
      loadCodes(editingId);
    } catch (e) {
      Alert.alert('Could not generate codes', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const onCopyCode = async (code: string) => {
    if (!ClipboardModule) return;
    try {
      await ClipboardModule.setStringAsync(code);
    } catch {
      // best-effort only
    }
  };

  const onCopyAllUnused = async () => {
    const unused = codes.filter((c) => !c.redeemed).map((c) => c.code);
    if (!unused.length || !ClipboardModule) return;
    try {
      await ClipboardModule.setStringAsync(unused.join('\n'));
      Alert.alert('Copied', `${unused.length} unused code(s) copied to your clipboard.`);
    } catch {
      // best-effort only
    }
  };

  const onDeleteCode = (code: LessonAccessCode) => {
    if (!editingId) return;
    Alert.alert('Delete this code?', `"${code.code}" will stop working. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLessonCode(editingId, code.id);
            loadCodes(editingId);
          } catch (e) {
            Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
          }
        },
      },
    ]);
  };

  const onSubmit = async () => {
    if (!id || !title.trim()) return;
    setError(null);

    // Empty = unlimited (null). Otherwise must be a whole number >= 1 — a
    // limit of 0 would just be a confusing way to say "never allowed".
    let maxViewsValue: number | null = null;
    if (maxViews.trim()) {
      const parsed = Number(maxViews.trim());
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError('View limit must be a whole number of 1 or more (or leave it empty for unlimited).');
        return;
      }
      maxViewsValue = parsed;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        await updateLesson(editingId, {
          title: title.trim(),
          video_url: videoUrl.trim() || undefined,
          // Sent as an explicit null (not omitted via `?? undefined`) when
          // the cover was removed, so the backend's exclude_unset check sees
          // it as a real "set to nothing" and cleans up the old upload —
          // same convention as Question.image_url (see backend/app/api/routes/questions.py).
          cover_image_url: coverImageUrl,
          content: content.trim() || undefined,
          max_views: maxViewsValue,
          exempt_from_exam_gate: exemptFromExamGate,
        });
      } else {
        await createLesson({
          course_id: id,
          title: title.trim(),
          video_url: videoUrl.trim() || undefined,
          cover_image_url: coverImageUrl ?? undefined,
          content: content.trim() || undefined,
          max_views: maxViewsValue,
          exempt_from_exam_gate: exemptFromExamGate,
        });
      }
      resetForm();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = (lessonId: string, lessonTitle: string) => {
    Alert.alert('Delete lecture?', `This will permanently delete "${lessonTitle}". This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLesson(lessonId);
            if (editingId === lessonId) {
              // The lecture's own saved video is cleaned up server-side as
              // part of deleting it (see backend/app/api/routes/lessons.py)
              // — this is only for a NOT-yet-saved replacement upload
              // still sitting in the form for the lecture that just got
              // deleted out from under it.
              discardIfUnsaved();
              resetForm();
            }
            load();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
          }
        },
      },
    ]);
  };

  if (!course) return null;

  return (
    <>
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      data={course.lessons}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={
        <>
          {/* Exams now live on their own dedicated screen instead of being
              a form buried at the bottom of this lecture editor — see
              app/admin/course/[id]/exams.tsx. This card is the one, obvious
              way in from here. */}
          <Pressable
            style={({ pressed }) => [styles.examsNavCard, pressed && styles.examsNavCardPressed]}
            onPress={() => router.push(`/admin/course/${id}/exams`)}
          >
            <View style={styles.examsNavIconWrap}>
              <Text style={styles.examsNavIcon}>📝</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.examsNavTitle}>Manage Exams</Text>
              <Text style={styles.examsNavSubtitle}>
                {examsCount ? `${examsCount} exam${examsCount === 1 ? '' : 's'} in this chapter` : 'No exams yet — add one'}
              </Text>
            </View>
            <Text style={styles.examsNavArrow}>›</Text>
          </Pressable>

          <Text style={styles.title}>{course.title} — Lectures</Text>
        </>
      }
      renderItem={({ item, index }) => (
        <View style={[styles.row, editingId === item.id && styles.rowEditing]}>
          <Pressable style={styles.rowMain} onPress={() => onEditPress(item.id)} disabled={loadingLesson}>
            {item.cover_image_url ? (
              <ResolvedImage
                url={item.cover_image_url}
                style={styles.rowThumb}
                containerStyle={styles.rowThumb}
                resizeMode="contain"
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {index + 1}. {item.title}
              </Text>
              {item.video_url ? <Text style={styles.rowMeta}>▶️ has video</Text> : null}
              {item.max_views != null ? (
                <Text style={styles.rowMeta}>🔒 view limit: {item.max_views}</Text>
              ) : null}
            </View>
          </Pressable>
          <Pressable onPress={() => router.push(`/admin/lesson/${item.id}`)} style={{ marginRight: 14 }}>
            <Text style={styles.quizLinkText}>Quiz</Text>
          </Pressable>
          <Pressable onPress={() => onDelete(item.id, item.title)}>
            <Text style={styles.removeText}>Delete</Text>
          </Pressable>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No lectures yet — add one below.</Text>}
      ListFooterComponent={
        <>
          <Text style={styles.label}>
            {editingId ? 'Editing lecture — tap another one to switch, or add a new one below' : 'Add a lecture'}
          </Text>
          <Text style={styles.hint}>
            Tap a lecture above to edit its title/video in place, instead of adding a duplicate.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Lecture title"
            placeholderTextColor="#9ca3af"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="Paste a video URL (optional if uploading below)"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            keyboardType="url"
            value={videoUrl}
            onChangeText={setVideoUrl}
          />
          <Text style={styles.hint}>
            Uploading a file below stores it in our own private video storage — no third-party branding,
            no link anyone outside the app can reach directly. A pasted YouTube (or other) link still
            works too if you'd rather use that instead.
          </Text>
          <Pressable style={styles.uploadButton} onPress={onPickVideo} disabled={uploading}>
            {uploading ? (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round(uploadProgress * 100)}%` }]} />
                </View>
                <Text style={styles.progressLabel}>
                  {Math.round(uploadProgress * 100)}% uploaded · {Math.round((1 - uploadProgress) * 100)}% left
                </Text>
              </View>
            ) : (
              <Text style={styles.uploadButtonText}>📤 Or upload a video from this device</Text>
            )}
          </Pressable>

          <Text style={styles.imageLabel}>Cover image (optional)</Text>
          <Text style={styles.hint}>
            Shown as poster art on the student's chapter screen, same style as chapter covers. Leave empty to show a
            plain placeholder tile instead.
          </Text>
          {coverImagePreview || coverImageUrl ? (
            <View style={styles.imagePreviewWrap}>
              {coverImagePreview ? (
                <Image source={{ uri: coverImagePreview }} style={styles.imagePreview} resizeMode="contain" />
              ) : (
                <ResolvedImage
                  url={coverImageUrl}
                  style={styles.imagePreview}
                  containerStyle={styles.imagePreview}
                  resizeMode="contain"
                />
              )}
            </View>
          ) : null}
          <View style={styles.imageActionsRow}>
            <Pressable style={styles.imageButton} onPress={pickCoverImage} disabled={uploadingCoverImage}>
              {uploadingCoverImage ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.imageButtonText}>{coverImageUrl ? 'Change cover' : 'Add cover image'}</Text>
              )}
            </Pressable>
            {coverImageUrl ? (
              <Pressable
                style={styles.imageButton}
                onPress={() => {
                  setCoverImageUrl(null);
                  setCoverImagePreview(null);
                }}
                disabled={uploadingCoverImage}
              >
                <Text style={styles.imageRemoveText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Notes / description (optional)"
            placeholderTextColor="#9ca3af"
            multiline
            value={content}
            onChangeText={setContent}
          />
          <TextInput
            style={styles.input}
            placeholder="View limit per student (optional — leave empty for unlimited)"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            value={maxViews}
            onChangeText={setMaxViews}
          />
          <Text style={styles.hint}>
            If set, each student can only open this lecture's video that many times. Manage a student who hit
            their limit by mistake (e.g. an accidental reload) from Manage Content → Video View Limits.
          </Text>

          {examsCount ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Skip the exam gate for this lecture</Text>
                <Text style={styles.hint}>
                  This chapter has one or more standalone exams (see "Manage Exams" above). Turn this on to keep THIS
                  lecture reachable even if a student hasn't passed an earlier exam yet.
                </Text>
              </View>
              <Switch
                value={exemptFromExamGate}
                onValueChange={setExemptFromExamGate}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
          ) : null}

          {editingId ? (
            <View style={styles.codesPanel}>
              <Text style={styles.codesPanelTitle}>🔑 Access codes</Text>
              <Text style={styles.hint}>
                Optional, separate from the view limit above. Generate one-time codes and hand them out — the
                moment you generate even one, this lecture requires a valid code before ANY student can open its
                video (in addition to any view limit). Leave this empty to keep the lecture open to everyone as
                usual.
              </Text>
              <View style={styles.codesGenerateRow}>
                <TextInput
                  style={[styles.input, styles.codesCountInput]}
                  keyboardType="number-pad"
                  value={generateCount}
                  onChangeText={setGenerateCount}
                />
                <Pressable style={styles.codesGenerateButton} onPress={onGenerateCodes} disabled={generating}>
                  {generating ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.codesGenerateButtonText}>Generate</Text>
                  )}
                </Pressable>
              </View>

              {codesLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
              ) : codes.length ? (
                <>
                  <View style={styles.codesSummaryRow}>
                    <Text style={styles.codesSummaryText}>
                      {codes.filter((c) => !c.redeemed).length} unused · {codes.filter((c) => c.redeemed).length} used
                      · {codes.length} total
                    </Text>
                    <Pressable onPress={onCopyAllUnused}>
                      <Text style={styles.codesCopyAllText}>Copy all unused</Text>
                    </Pressable>
                  </View>
                  {codes.map((c) => (
                    <View key={c.id} style={styles.codeRow}>
                      <Text style={[styles.codeRowText, c.redeemed && styles.codeRowTextUsed]}>{c.code}</Text>
                      <Text style={[styles.codeRowStatus, c.redeemed && styles.codeRowStatusUsed]}>
                        {c.redeemed ? 'Used' : 'Unused'}
                      </Text>
                      <Pressable onPress={() => onCopyCode(c.code)} style={{ marginLeft: 10 }}>
                        <Text style={styles.codeRowAction}>Copy</Text>
                      </Pressable>
                      {!c.redeemed ? (
                        <Pressable onPress={() => onDeleteCode(c)} style={{ marginLeft: 10 }}>
                          <Text style={styles.codeRowActionDelete}>Delete</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </>
              ) : (
                <Text style={[styles.hint, { marginTop: 8 }]}>No codes generated yet for this lecture.</Text>
              )}
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.formActions}>
            {editingId ? (
              <Pressable style={styles.cancelButton} onPress={onCancelEdit}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.button, styles.formActionsButton]} onPress={onSubmit} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{editingId ? 'Save Changes' : 'Add Lecture'}</Text>
              )}
            </Pressable>
          </View>
        </>
      }
    />
    <ImageCropModal
      visible={!!coverCropTarget}
      imageUri={coverCropTarget?.rawUri ?? null}
      initialSize={coverCropTarget ? { width: coverCropTarget.width, height: coverCropTarget.height } : null}
      aspectRatio={16 / 9}
      title="Crop cover image"
      onCancel={() => setCoverCropTarget(null)}
      onDone={onCoverCropDone}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm, color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowEditing: { backgroundColor: colors.primary + '14', borderRadius: radius.md, paddingHorizontal: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowThumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quizLinkText: { color: colors.primary, fontWeight: '600' },
  removeText: { color: colors.danger, fontWeight: '600' },
  empty: { color: colors.textFaint, marginVertical: 20 },
  label: { fontSize: 14, color: colors.textMuted, marginTop: 16, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 10 },
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
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  uploadButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  uploadButtonText: { color: colors.primary, fontWeight: '600' },
  progressWrap: { width: '100%', alignItems: 'center' },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  progressLabel: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  imageLabel: { fontSize: 14, color: colors.textMuted, marginTop: 16, marginBottom: 4 },
  imagePreviewWrap: { marginBottom: 10 },
  imagePreview: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  imageActionsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  imageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageButtonText: { color: colors.primary, fontWeight: '600' },
  imageRemoveText: { color: colors.danger, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
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

  // "Manage Exams" nav card — same pattern as the admin home screen's
  // "AI Question Limits" / "Video View Limits" quick-nav cards, so exams
  // read as their own proper destination instead of a form tucked into
  // this lecture editor.
  examsNavCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '14',
    borderWidth: 1,
    borderColor: colors.accent + '33',
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: spacing.md,
  },
  examsNavCardPressed: { backgroundColor: colors.accent + '22' },
  examsNavIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  examsNavIcon: { fontSize: 22 },
  examsNavTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  examsNavSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  examsNavArrow: { fontSize: 22, color: colors.accent, fontWeight: '600' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 10,
  },
  switchLabel: { color: colors.text, fontWeight: '600', fontSize: 13, marginBottom: 2 },
  codesPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 6,
    marginBottom: 14,
    backgroundColor: colors.surfaceAlt,
  },
  codesPanelTitle: { color: colors.text, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  codesGenerateRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  codesCountInput: { flex: 1, marginBottom: 0, paddingVertical: 10 },
  codesGenerateButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codesGenerateButtonText: { color: colors.onPrimary, fontWeight: '600' },
  codesSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 4,
  },
  codesSummaryText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  codesCopyAllText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  codeRowText: { color: colors.text, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  codeRowTextUsed: { color: colors.textFaint, textDecorationLine: 'line-through' },
  codeRowStatus: { color: colors.accentDark, fontSize: 11, fontWeight: '600' },
  codeRowStatusUsed: { color: colors.textFaint },
  codeRowAction: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  codeRowActionDelete: { color: colors.danger, fontSize: 12, fontWeight: '600' },
});
