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
  createTeacherGroup,
  deleteCourse,
  deleteTeacher,
  deleteTeacherGroup,
  getSubject,
  linkTeacherAccount,
  listAllUsers,
  listTeacherGroups,
  listTeachers,
  unlinkTeacherAccount,
  updateCourse,
  updateTeacher,
  uploadImage,
} from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import { subjectIconSource } from '@/lib/subjectIcon';
import { GRADE_LEVELS, type GradeLevel, type SubjectDetail, type Teacher, type TeacherGroup, type User } from '@/lib/types';

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

  // --- Instructor-account linking (see backend/app/models/teacher.py's
  // user_id) — only meaningful while editing an existing teacher card,
  // never while creating a new one.
  const [teacherLinkEmail, setTeacherLinkEmail] = useState('');
  const [teacherLinkError, setTeacherLinkError] = useState<string | null>(null);
  const [teacherLinkSubmitting, setTeacherLinkSubmitting] = useState(false);
  // Every registered account, fetched once so the email field below can
  // suggest matches locally as the admin types instead of round-tripping to
  // the server on every keystroke. `emailSuggestionsDismissed` hides the
  // dropdown right after a suggestion is tapped (or the field is cleared)
  // without touching teacherLinkEmail itself, since the just-picked email
  // would otherwise still match its own substring and reopen the list.
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [emailSuggestionsDismissed, setEmailSuggestionsDismissed] = useState(false);

  // --- Teacher groups (only while editing an existing teacher card) ------
  const [teacherGroups, setTeacherGroups] = useState<TeacherGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

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

  // Loaded once — not re-fetched on every focus like `load()` above, since
  // the account list rarely changes within one admin session and this is
  // only ever used for the link-by-email suggestions below.
  React.useEffect(() => {
    listAllUsers().then(setAllUsers).catch(() => {});
  }, []);

  // Reload the group list whenever the selected teacher changes (or is cleared).
  React.useEffect(() => {
    if (!teacherEditingId) { setTeacherGroups([]); return; }
    listTeacherGroups(teacherEditingId).then(setTeacherGroups).catch(() => {});
  }, [teacherEditingId]);

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
    setTeacherLinkEmail('');
    setTeacherLinkError(null);
    setEmailSuggestionsDismissed(false);
    setTeacherGroups([]);
    setNewGroupName('');
    setGroupError(null);
  };

  const onEditTeacher = (teacher: Teacher) => {
    setTeacherEditingId(teacher.id);
    setTeacherName(teacher.name);
    setTeacherPhotoUrl(teacher.photo_url);
    setTeacherPhotoPreview(null);
    setTeacherError(null);
    setTeacherLinkEmail('');
    setTeacherLinkError(null);
    setEmailSuggestionsDismissed(false);
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

  const onLinkTeacher = async () => {
    if (!teacherEditingId || !teacherLinkEmail.trim()) return;
    setTeacherLinkError(null);
    setTeacherLinkSubmitting(true);
    try {
      await linkTeacherAccount(teacherEditingId, teacherLinkEmail.trim());
      setTeacherLinkEmail('');
      load();
    } catch (e) {
      setTeacherLinkError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setTeacherLinkSubmitting(false);
    }
  };

  const onUnlinkTeacher = async () => {
    if (!teacherEditingId) return;
    setTeacherLinkError(null);
    setTeacherLinkSubmitting(true);
    try {
      await unlinkTeacherAccount(teacherEditingId);
      load();
    } catch (e) {
      setTeacherLinkError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setTeacherLinkSubmitting(false);
    }
  };

  // --- Teacher groups -----------------------------------------------------
  const onAddGroup = async () => {
    if (!teacherEditingId || !newGroupName.trim()) return;
    setGroupError(null);
    setGroupSubmitting(true);
    try {
      const created = await createTeacherGroup(teacherEditingId, newGroupName.trim());
      setTeacherGroups((prev) => [...prev, created]);
      setNewGroupName('');
    } catch (e) {
      setGroupError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setGroupSubmitting(false);
    }
  };

  const onDeleteGroup = (groupId: string, groupName: string) => {
    if (!teacherEditingId) return;
    Alert.alert(
      'Delete group?',
      `"${groupName}" will be removed. Students currently in this group will become ungrouped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTeacherGroup(teacherEditingId, groupId);
              setTeacherGroups((prev) => prev.filter((g) => g.id !== groupId));
            } catch (e) {
              Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
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
  // Same lookup, but read as "the teacher card currently open for editing"
  // rather than "the filter applied to the chapters grid below" — used for
  // the instructor-account linking section, which only makes sense while
  // editing (not while still filling in the "Add a teacher" form).
  const editingTeacher = filterTeacher;

  // Local email autocomplete for the "link account" field below — matches
  // anywhere in the email (not just the start), since an admin might
  // remember the school domain part more easily than the name prefix.
  // Accounts already linked to a DIFFERENT teacher card in this subject are
  // excluded, since attempting to link them again would just fail on the
  // server with "already linked to a different teacher profile".
  const emailQuery = teacherLinkEmail.trim().toLowerCase();
  const otherLinkedUserIds = new Set(
    teachers.filter((t) => t.id !== teacherEditingId && t.user_id).map((t) => t.user_id as string),
  );
  const emailSuggestions =
    !emailSuggestionsDismissed && emailQuery.length > 0
      ? allUsers
          .filter((u) => u.email.toLowerCase().includes(emailQuery) && !otherLinkedUserIds.has(u.id))
          .slice(0, 6)
      : [];

  const onSelectEmailSuggestion = (u: User) => {
    setTeacherLinkEmail(u.email);
    setEmailSuggestionsDismissed(true);
  };

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

      {/* --- Instructor account link (only while editing an existing
          teacher card — a brand-new one has to be saved first) ---------- */}
      {editingTeacher ? (
        <View style={styles.linkBox}>
          <Text style={styles.label}>Instructor account</Text>
          {editingTeacher.user_id ? (
            <>
              <Text style={styles.linkedText}>
                Linked to {editingTeacher.linked_full_name || editingTeacher.linked_email}
                {editingTeacher.linked_full_name ? ` (${editingTeacher.linked_email})` : ''}
              </Text>
              <Text style={styles.hint}>
                This account can now create/edit lessons and exams in every chapter assigned to {editingTeacher.name}.
              </Text>
              <Pressable style={styles.unlinkButton} onPress={onUnlinkTeacher} disabled={teacherLinkSubmitting}>
                {teacherLinkSubmitting ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.unlinkButtonText}>Unlink account</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Not linked to any account yet — {editingTeacher.name} is just a display card. Link a registered
                account by email to let them upload their own lessons/exams into their chapters.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="teacher@example.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                keyboardType="email-address"
                value={teacherLinkEmail}
                onChangeText={(t) => {
                  setTeacherLinkEmail(t);
                  setEmailSuggestionsDismissed(false);
                }}
              />
              {emailSuggestions.length > 0 ? (
                <View style={styles.suggestionsBox}>
                  {emailSuggestions.map((u, index) => (
                    <Pressable
                      key={u.id}
                      style={[styles.suggestionRow, index === emailSuggestions.length - 1 && styles.suggestionRowLast]}
                      onPress={() => onSelectEmailSuggestion(u)}
                    >
                      <Text style={styles.suggestionName} numberOfLines={1}>
                        {u.full_name || 'بدون اسم'}
                      </Text>
                      <Text style={styles.suggestionEmail} numberOfLines={1}>
                        {u.email}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable style={styles.button} onPress={onLinkTeacher} disabled={teacherLinkSubmitting}>
                {teacherLinkSubmitting ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.buttonText}>Link account</Text>
                )}
              </Pressable>
            </>
          )}
          {teacherLinkError ? <Text style={styles.error}>{teacherLinkError}</Text> : null}
        </View>
      ) : null}

      {/* --- Teacher groups (only while editing an existing teacher) ------- */}
      {editingTeacher ? (
        <View style={styles.groupBox}>
          <Text style={styles.label}>Student groups</Text>
          <Text style={styles.hint}>
            Create named groups for {editingTeacher.name}'s students. Students pick a group when they first open a lesson.
          </Text>

          {teacherGroups.length > 0 ? (
            <View style={styles.groupList}>
              {teacherGroups.map((g) => (
                <View key={g.id} style={styles.groupRow}>
                  <Text style={styles.groupName}>{g.name}</Text>
                  <View style={styles.groupRowActions}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/admin/attendance/[groupId]',
                          params: { groupId: g.id, teacherId: teacherEditingId as string, groupName: g.name },
                        })
                      }
                      hitSlop={8}
                    >
                      <Text style={styles.scanLinkText}>📷 Scan attendance</Text>
                    </Pressable>
                    <Pressable onPress={() => onDeleteGroup(g.id, g.name)} hitSlop={8}>
                      <Text style={styles.removeText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.hint, { marginTop: 8 }]}>No groups yet.</Text>
          )}

          <View style={styles.groupInputRow}>
            <TextInput
              style={[styles.input, styles.groupInput]}
              placeholder="Group name, e.g. المجموعة أ"
              placeholderTextColor="#9ca3af"
              value={newGroupName}
              onChangeText={setNewGroupName}
            />
            <Pressable
              style={[styles.groupAddButton, groupSubmitting && styles.submitBtnDisabled]}
              onPress={onAddGroup}
              disabled={groupSubmitting || !newGroupName.trim()}
            >
              {groupSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.groupAddButtonText}>+ Add</Text>
              )}
            </Pressable>
          </View>
          {groupError ? <Text style={styles.error}>{groupError}</Text> : null}
        </View>
      ) : null}

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
              fallback={
                <View style={[styles.chapterCover, styles.photoPlaceholder]}>
                  <Image source={subjectIconSource(subject.name)} style={styles.subjectIconFallback} />
                </View>
              }
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
  // Direction-B icon badge already bakes in its own colored background —
  // sized a bit smaller than the full chapterCover fallback box so it reads
  // as a centered badge rather than stretching edge-to-edge.
  subjectIconFallback: { width: 40, height: 40 },
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
  linkBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  linkedText: { color: colors.success, fontWeight: '600', fontSize: 14, marginBottom: 4 },
  suggestionsBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginTop: -4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionName: { color: colors.text, fontWeight: '600', fontSize: 14 },
  suggestionEmail: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  unlinkButton: {
    borderWidth: 1,
    borderColor: colors.danger + '55',
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  unlinkButtonText: { color: colors.danger, fontWeight: '600' },
  groupBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  groupList: {
    marginTop: spacing.sm,
    gap: 4,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  groupName: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 1 },
  groupRowActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  scanLinkText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  groupInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  groupInput: { flex: 1, marginBottom: 0 },
  groupAddButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  groupAddButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
