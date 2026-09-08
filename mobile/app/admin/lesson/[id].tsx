import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ImageCropModal } from '@/components/ImageCropPicker';
import { MathSymbolInput } from '@/components/MathSymbolInput';
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
import { colors, radius, spacing } from '@/constants/theme';
import type { LessonDetail, QuestionAdmin } from '@/lib/types';

const CHOICE_KEYS = ['A', 'B', 'C', 'D'] as const;

// Diagram/photo picked straight from expo-image-picker, awaiting crop — see
// ImageCropModal's initialSize prop for why width/height are carried
// through from the picker's own asset instead of re-probed later.
type CropTarget = { rawUri: string; width: number; height: number } | null;

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

  if (!lesson) return null;

  return (
    <>
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      data={questions}
      keyExtractor={(q) => q.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>{lesson.title} — Quiz Questions</Text>
          <Text style={styles.hint}>
            Questions sharing the same "pause at" second appear together as one mini-quiz when the video reaches
            that point. Leave "pause at" empty to show a question once the video ends instead. A student must score
            ≥75% on a part's quiz before the next lecture unlocks.
          </Text>
        </>
      }
      renderItem={({ item, index }) => (
        <View style={[styles.row, editingId === item.id && styles.rowEditing]}>
          <Pressable style={{ flex: 1 }} onPress={() => onEditPress(item)}>
            <Text style={styles.rowTitle}>
              {index + 1}. {item.prompt}
            </Text>
            <Text style={styles.rowMeta}>
              {item.question_type === 'multiple_choice' ? 'Multiple choice' : 'Text answer'} · pause at{' '}
              {item.pause_at_seconds != null ? `${item.pause_at_seconds}s` : 'end of video'}
            </Text>
          </Pressable>
          <Pressable onPress={() => onDelete(item.id)}>
            <Text style={styles.removeText}>Delete</Text>
          </Pressable>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No quiz questions yet — add one below.</Text>}
      ListFooterComponent={
        <>
          <Text style={styles.label}>{editingId ? 'Editing question' : 'Add a question'}</Text>

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

          <MathSymbolInput
            style={[styles.input, styles.multiline]}
            placeholder="Question prompt (supports $math$ and **bold**)"
            placeholderTextColor="#9ca3af"
            multiline
            value={prompt}
            onChangeText={setPrompt}
          />

          {questionType === 'multiple_choice' ? (
            <>
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
                    <MathSymbolInput
                      style={styles.input}
                      placeholder={`Choice ${key}`}
                      placeholderTextColor="#9ca3af"
                      value={choiceTexts[key]}
                      onChangeText={(v) => setChoiceTexts((prev) => ({ ...prev, [key]: v }))}
                    />
                  </View>
                </View>
              ))}
              <Text style={styles.hint}>Tap the letter next to the correct choice.</Text>
            </>
          ) : (
            <MathSymbolInput
              style={styles.input}
              placeholder="Correct answer"
              placeholderTextColor="#9ca3af"
              value={correctAnswer}
              onChangeText={setCorrectAnswer}
            />
          )}

          <MathSymbolInput
            style={[styles.input, styles.multiline]}
            placeholder="Explanation shown after answering (optional, supports $math$)"
            placeholderTextColor="#9ca3af"
            multiline
            value={explanation}
            onChangeText={setExplanation}
          />

          <Text style={styles.imageLabel}>Diagram / photo of the problem (optional)</Text>
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
                <Text style={styles.imageButtonText}>{imageUrl ? 'Change image' : 'Add image'}</Text>
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

          <TextInput
            style={styles.input}
            placeholder="Pause at (seconds into the video, optional)"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            value={pauseAtSeconds}
            onChangeText={setPauseAtSeconds}
          />

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
                <Text style={styles.buttonText}>{editingId ? 'Save Changes' : 'Add Question'}</Text>
              )}
            </Pressable>
          </View>
        </>
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
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm, color: colors.text },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 14, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowEditing: { backgroundColor: colors.primary + '14', borderRadius: radius.md, paddingHorizontal: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  removeText: { color: colors.danger, fontWeight: '600' },
  empty: { color: colors.textFaint, marginVertical: 20 },
  label: { fontSize: 14, color: colors.textMuted, marginTop: 16, marginBottom: 10 },
  typeToggle: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  typeButtonActive: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
  typeButtonText: { color: colors.textMuted, fontWeight: '600' },
  typeButtonTextActive: { color: colors.primary },
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
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  imageLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
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
  choiceInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceKeyButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  choiceKeyButtonActive: { borderColor: colors.success, backgroundColor: colors.success + '1A' },
  choiceKeyText: { color: colors.textMuted, fontWeight: '700' },
  choiceKeyTextActive: { color: colors.success },
  choiceInput: { flex: 1 },
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
});
