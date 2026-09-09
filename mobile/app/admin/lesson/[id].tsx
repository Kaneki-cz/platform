import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ImageCropModal } from '@/components/ImageCropPicker';
import { MathSymbolInput, useSharedMathToolbar } from '@/components/MathSymbolInput';
import { MathText } from '@/components/MathText';
import { ResolvedImage } from '@/components/ResolvedImage';
import {
  ApiError,
  createQuestion,
  deleteQuestion,
  getLesson,
  getLessonQuestionsAdmin,
  updateQuestion,
  uploadImage,
} from '@/lib/api';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import type { LessonDetail, QuestionAdmin } from '@/lib/types';

const CHOICE_KEYS = ['A', 'B', 'C', 'D'] as const;

// Diagram/photo picked straight from expo-image-picker, awaiting crop — see
// ImageCropModal's initialSize prop for why width/height are carried
// through from the picker's own asset instead of re-probed later.
type CropTarget = { rawUri: string; width: number; height: number } | null;

// Same redesign pass as app/admin/exam/[id].tsx (identical form shape,
// just for a lecture's segment-quiz questions instead of an exam's) — see
// that file's comment for the reasoning. Only real difference here is the
// extra "Pause at" field, which gets its own section too.
export default function ManageLessonQuestionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [questions, setQuestions] = useState<QuestionAdmin[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [questionType, setQuestionType] = useState<'multiple_choice' | 'free_response'>('multiple_choice');
  const [prompt, setPrompt] = useState('');
  const [choiceTexts, setChoiceTexts] = useState<Record<string, string>>({ A: '', B: '', C: '', D: '' });
  const [correctChoice, setCorrectChoice] = useState<string>('A');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [pauseAtSeconds, setPauseAtSeconds] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null); // uploaded b2:/http url, ready to save
  const [imagePreview, setImagePreview] = useState<string | null>(null); // local file, just-cropped

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cropTarget, setCropTarget] = useState<CropTarget>(null);

  // One toolbar (math/fraction/exponent/subscript, undo, quick symbols)
  // shared by all 4 choice fields below instead of each repeating its own —
  // see useSharedMathToolbar's own comment for how "the active field" works.
  const { toolbar: choiceToolbar, modals: choiceModals, getFieldProps: getChoiceFieldProps, activeKey: activeChoiceKey } =
    useSharedMathToolbar(choiceTexts, (key, v) => setChoiceTexts((prev) => ({ ...prev, [key]: v })));

  const load = useCallback(() => {
    if (!id) return;
    getLesson(id).then(setLesson).catch(() => {});
    getLessonQuestionsAdmin(id).then(setQuestions).catch(() => {});
  }, [id]);

  useFocusEffect(load);

  const resetForm = () => {
    setEditingId(null);
    setQuestionType('multiple_choice');
    setPrompt('');
    setChoiceTexts({ A: '', B: '', C: '', D: '' });
    setCorrectChoice('A');
    setCorrectAnswer('');
    setExplanation('');
    setPauseAtSeconds('');
    setImageUrl(null);
    setImagePreview(null);
    setError(null);
  };

  // --- Question image picking (diagram/photo of the physics problem) ----
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is required to pick a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setCropTarget({ rawUri: asset.uri, width: asset.width, height: asset.height });
  };

  const onCropDone = async (croppedUri: string) => {
    setCropTarget(null);
    setUploadingImage(true);
    try {
      const url = await uploadImage(croppedUri, `question-${Date.now()}.jpg`, 'image/jpeg');
      setImageUrl(url);
      setImagePreview(croppedUri);
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(`Image upload failed: ${detail}`);
    } finally {
      setUploadingImage(false);
    }
  };

  const onEditPress = (q: QuestionAdmin) => {
    setError(null);
    setEditingId(q.id);
    setPrompt(q.prompt);
    setExplanation(q.explanation ?? '');
    setPauseAtSeconds(q.pause_at_seconds != null ? String(q.pause_at_seconds) : '');
    setImageUrl(q.image_url ?? null);
    setImagePreview(null);
    if (q.question_type === 'multiple_choice' && q.choices) {
      setQuestionType('multiple_choice');
      setChoiceTexts({ A: '', B: '', C: '', D: '', ...q.choices });
      setCorrectChoice(q.correct_answer);
    } else {
      setQuestionType('free_response');
      setCorrectAnswer(q.correct_answer);
    }
  };

  const onSubmit = async () => {
    if (!id || !prompt.trim()) return;
    setError(null);

    const usedChoices = CHOICE_KEYS.filter((k) => choiceTexts[k].trim().length > 0);
    if (questionType === 'multiple_choice' && usedChoices.length < 2) {
      setError('Add at least 2 choices.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        lesson_id: id,
        prompt: prompt.trim(),
        question_type: questionType,
        choices:
          questionType === 'multiple_choice'
            ? Object.fromEntries(usedChoices.map((k) => [k, choiceTexts[k].trim()]))
            : null,
        correct_answer: questionType === 'multiple_choice' ? correctChoice : correctAnswer.trim(),
        explanation: explanation.trim() || undefined,
        pause_at_seconds: pauseAtSeconds.trim() ? Math.max(0, Math.round(Number(pauseAtSeconds))) : null,
        image_url: imageUrl,
      };
      if (editingId) {
        await updateQuestion(editingId, payload);
      } else {
        await createQuestion(payload);
      }
      resetForm();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = (questionId: string) => {
    Alert.alert('Delete question?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteQuestion(questionId);
            if (editingId === questionId) resetForm();
            load();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Something went wrong.');
          }
        },
      },
    ]);
  };

  // Clones a question in place (same lesson, right after the original in the
  // list) so a near-identical follow-up ("same choices, one number changed")
  // starts from a full copy instead of retyping everything, "pause at" and
  // all. No confirmation dialog — unlike delete, this is fully reversible
  // with a single tap of the delete button on the new copy.
  const onDuplicate = async (q: QuestionAdmin) => {
    if (!id) return;
    try {
      await createQuestion({
        lesson_id: id,
        prompt: q.prompt,
        question_type: q.question_type,
        choices: q.choices,
        correct_answer: q.correct_answer,
        explanation: q.explanation ?? undefined,
        pause_at_seconds: q.pause_at_seconds,
        image_url: q.image_url,
      });
      load();
    } catch (e) {
      Alert.alert('Could not duplicate', e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };

  if (!lesson) return null;

  return (
    <>
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      keyboardShouldPersistTaps="handled"
      data={questions}
      keyExtractor={(q) => q.id}
      ListHeaderComponent={
        <>
          <View style={styles.eyebrow}>
            <Text style={styles.eyebrowText} numberOfLines={1}>
              🎬 {lesson.title}
            </Text>
          </View>
          <Text style={styles.title}>Quiz Questions</Text>
          <Text style={styles.hint}>
            Questions sharing the same "pause at" second appear together as one mini-quiz when the video reaches
            that point. Leave "pause at" empty to show a question once the video ends instead. A student must score
            ≥75% on a part's quiz before the next lecture unlocks.
          </Text>
        </>
      }
      renderItem={({ item, index }) => (
        <Pressable style={[styles.card, editingId === item.id && styles.cardEditing]} onPress={() => onEditPress(item)}>
          <View style={styles.cardTop}>
            <View style={[styles.badge, item.question_type !== 'multiple_choice' && styles.badgeText]}>
              <Text style={styles.badgeIcon}>{item.question_type === 'multiple_choice' ? '🔘' : '✏️'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <MathText
                text={`${index + 1}. ${item.prompt}`}
                color={colors.text}
                fontSize={13}
                numberOfLines={2}
                style={styles.cardPrompt}
              />
              <View style={styles.chipsRow}>
                <Text style={styles.chip}>
                  {item.question_type === 'multiple_choice' ? 'Multiple choice' : 'Text answer'}
                </Text>
                <Text style={[styles.chip, styles.chipPause]}>
                  ⏱ {item.pause_at_seconds != null ? `${item.pause_at_seconds}s` : 'end of video'}
                </Text>
              </View>
            </View>
            <View style={styles.cardActions}>
              <Pressable
                style={[styles.deleteIconButton, styles.duplicateIconButton]}
                onPress={() => onDuplicate(item)}
                hitSlop={8}
              >
                <Text style={styles.duplicateIconText}>⧉</Text>
              </Pressable>
              <Pressable style={styles.deleteIconButton} onPress={() => onDelete(item.id)} hitSlop={8}>
                <Text style={styles.deleteIconText}>🗑</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No quiz questions yet — add one below.</Text>}
      ListFooterComponent={
        <View style={[styles.formCard, { marginTop: questions.length ? 16 : 4 }]}>
          {editingId ? (
            <View style={styles.editBanner}>
              <Text style={styles.editBannerText}>✏️ Editing question {questions.findIndex((q) => q.id === editingId) + 1}</Text>
            </View>
          ) : (
            <Text style={styles.formTitle}>➕ Add a question</Text>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>🔀 Question type</Text>
            <View style={styles.typeToggle}>
              <Pressable
                style={[styles.typeButton, questionType === 'multiple_choice' && styles.typeButtonActive]}
                onPress={() => setQuestionType('multiple_choice')}
              >
                <Text style={[styles.typeButtonText, questionType === 'multiple_choice' && styles.typeButtonTextActive]}>
                  Multiple choice
                </Text>
              </Pressable>
              <Pressable
                style={[styles.typeButton, questionType === 'free_response' && styles.typeButtonActive]}
                onPress={() => setQuestionType('free_response')}
              >
                <Text style={[styles.typeButtonText, questionType === 'free_response' && styles.typeButtonTextActive]}>
                  Text answer
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>❓ Question prompt</Text>
            <MathSymbolInput
              style={[styles.input, styles.multiline]}
              placeholder="Question prompt (supports $math$ and **bold**)"
              placeholderTextColor={colors.textFaint}
              multiline
              value={prompt}
              onChangeText={setPrompt}
            />
          </View>

          {questionType === 'multiple_choice' ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>☑️ Choices — tap the correct letter</Text>
              {choiceToolbar}
              {CHOICE_KEYS.map((key) => (
                <View key={key} style={styles.choiceInputRow}>
                  <Pressable
                    style={[styles.choiceKeyButton, correctChoice === key && styles.choiceKeyButtonActive]}
                    onPress={() => setCorrectChoice(key)}
                  >
                    <Text style={[styles.choiceKeyText, correctChoice === key && styles.choiceKeyTextActive]}>
                      {key}
                    </Text>
                  </Pressable>
                  <View style={styles.choiceInput}>
                    <TextInput
                      {...getChoiceFieldProps(key)}
                      style={[styles.input, activeChoiceKey === key && styles.choiceInputFocused]}
                      placeholder={`Choice ${key}`}
                      placeholderTextColor={colors.textFaint}
                    />
                    {choiceTexts[key].trim() ? (
                      <MathText
                        text={choiceTexts[key]}
                        color={colors.textMuted}
                        fontSize={12}
                        style={styles.choicePreview}
                      />
                    ) : null}
                  </View>
                  {correctChoice === key ? <Text style={styles.correctTag}>✓ correct</Text> : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>✅ Correct answer</Text>
              <MathSymbolInput
                style={styles.input}
                placeholder="Correct answer"
                placeholderTextColor={colors.textFaint}
                value={correctAnswer}
                onChangeText={setCorrectAnswer}
              />
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>💡 Explanation (optional)</Text>
            <MathSymbolInput
              style={[styles.input, styles.multiline]}
              placeholder="Shown after answering (optional, supports $math$)"
              placeholderTextColor={colors.textFaint}
              multiline
              value={explanation}
              onChangeText={setExplanation}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>🖼 Diagram / photo (optional)</Text>
            {imagePreview || imageUrl ? (
              <View style={styles.imagePreviewWrap}>
                {imagePreview ? (
                  <Image source={{ uri: imagePreview }} style={styles.imagePreview} />
                ) : (
                  <ResolvedImage url={imageUrl} style={styles.imagePreview} containerStyle={styles.imagePreview} />
                )}
              </View>
            ) : null}
            <View style={styles.imageActionsRow}>
              <Pressable style={styles.imageButton} onPress={pickImage} disabled={uploadingImage}>
                {uploadingImage ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={styles.imageButtonText}>{imageUrl ? '🔁 Change image' : '＋ Add image'}</Text>
                )}
              </Pressable>
              {imageUrl ? (
                <Pressable
                  style={styles.imageButton}
                  onPress={() => {
                    setImageUrl(null);
                    setImagePreview(null);
                  }}
                  disabled={uploadingImage}
                >
                  <Text style={styles.imageRemoveText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={[styles.section, { marginBottom: 0 }]}>
            <Text style={styles.sectionLabel}>⏱ Pause at (seconds into the video, optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Leave empty to show at the end of the video"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              value={pauseAtSeconds}
              onChangeText={setPauseAtSeconds}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.formActions}>
            {editingId ? (
              <Pressable style={styles.cancelButton} onPress={resetForm}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.button, styles.formActionsButton]} onPress={onSubmit} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{editingId ? '💾 Save Changes' : '＋ Add Question'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      }
    />
    <ImageCropModal
      visible={!!cropTarget}
      imageUri={cropTarget?.rawUri ?? null}
      initialSize={cropTarget ? { width: cropTarget.width, height: cropTarget.height } : null}
      aspectRatio={4 / 3}
      title="Crop question image"
      onCancel={() => setCropTarget(null)}
      onDone={onCropDone}
    />
    {choiceModals}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  eyebrow: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent + '24',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  eyebrowText: { color: colors.accent, fontSize: 12, fontFamily: fonts.bold },
  title: { fontSize: 22, fontFamily: fonts.bold, marginBottom: spacing.xs, color: colors.text },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: spacing.md, lineHeight: 18, fontFamily: fonts.regular },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...cardShadow,
  },
  cardEditing: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.violet + '2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { backgroundColor: colors.primary + '20' },
  badgeIcon: { fontSize: 15 },
  cardPrompt: { fontSize: 13, color: colors.text, marginBottom: 6, lineHeight: 18, fontFamily: fonts.regular },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    alignSelf: 'flex-start',
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  chipPause: { color: colors.accent, borderColor: colors.accent + '59', backgroundColor: colors.accent + '1A' },
  cardActions: { flexDirection: 'row', gap: 6 },
  deleteIconButton: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIconText: { fontSize: 13 },
  duplicateIconButton: { backgroundColor: colors.primary + '20' },
  duplicateIconText: { fontSize: 13, color: colors.primary },
  empty: { color: colors.textFaint, marginVertical: 20, fontFamily: fonts.regular },

  formCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  formTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.sm },
  editBanner: {
    backgroundColor: colors.accent + '1F',
    borderWidth: 1,
    borderColor: colors.accent + '59',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
  },
  editBannerText: { color: colors.accent, fontSize: 12.5, fontFamily: fonts.bold },

  section: { marginBottom: spacing.md },
  sectionLabel: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.textMuted, marginBottom: spacing.sm },

  typeToggle: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
  },
  typeButton: { flex: 1, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  typeButtonActive: { backgroundColor: colors.primary },
  typeButtonText: { color: colors.textMuted, fontFamily: fonts.semiBold, fontSize: 12.5 },
  typeButtonTextActive: { color: colors.onPrimary },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  imagePreviewWrap: { marginBottom: 10 },
  imagePreview: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  imageActionsRow: { flexDirection: 'row', gap: 10 },
  imageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageButtonText: { color: colors.primary, fontFamily: fonts.semiBold },
  imageRemoveText: { color: colors.danger, fontFamily: fonts.semiBold },
  choiceInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceKeyButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  choiceKeyButtonActive: { borderColor: colors.success, backgroundColor: colors.success + '2A' },
  choiceKeyText: { color: colors.textMuted, fontFamily: fonts.bold },
  choiceKeyTextActive: { color: colors.success },
  choiceInput: { flex: 1 },
  choiceInputFocused: { borderColor: colors.primary },
  choicePreview: { marginTop: -6, marginBottom: 10 },
  correctTag: {
    color: colors.success,
    fontSize: 9.5,
    fontFamily: fonts.bold,
    backgroundColor: colors.success + '1F',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  formActionsButton: { flex: 1.4, marginBottom: 0 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.semiBold },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 16 },
  error: { color: colors.danger, marginBottom: 10, fontFamily: fonts.regular },
});
