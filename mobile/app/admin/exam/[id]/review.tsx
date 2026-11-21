import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOutLeft, LinearTransition } from 'react-native-reanimated';

import { ImageViewerModal } from '@/components/ImageViewerModal';
import { MathText } from '@/components/MathText';
import { PressableScale, Skeleton } from '@/components/motion';
import { ResolvedImage } from '@/components/ResolvedImage';
import { ApiError, listExamReviews, reviewEssayAnswer } from '@/lib/api';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { ReviewItem } from '@/lib/types';

type Tab = 'pending' | 'reviewed';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Teacher grading queue for an exam's essay answers. "To grade" lists every
 * ungraded answer oldest first; each gets 0..max points (one tap for full
 * marks or zero) and an optional comment the student sees. Grading the last
 * essay on an attempt gives that attempt its final score. "Graded" lists
 * past grades, which can be changed. Reached from the exam card on
 * app/admin/course/[id]/exams.tsx.
 */
export default function ExamReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    (which: Tab) => {
      if (!id) return;
      setItems(null);
      setFailed(false);
      listExamReviews(id, which)
        .then(setItems)
        .catch(() => setFailed(true));
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [load, tab]),
  );

  const onGraded = (item: ReviewItem, points: number, comment: string, finalScore: number | null, passed: boolean | null) => {
    if (tab === 'pending') {
      setItems((prev) => (prev ?? []).filter((x) => x.question_attempt_id !== item.question_attempt_id));
    } else {
      setItems((prev) =>
        (prev ?? []).map((x) =>
          x.question_attempt_id === item.question_attempt_id ? { ...x, points_awarded: points, teacher_comment: comment || null } : x,
        ),
      );
    }
    if (finalScore != null) {
      Alert.alert(
        'Attempt fully graded',
        `${item.student_name || item.student_email}: ${Math.round(finalScore)}% — ${passed ? 'passed' : 'not passed'}.`,
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['pending', 'reviewed'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'pending' ? 'To grade' : 'Graded'}</Text>
          </Pressable>
        ))}
      </View>

      {failed ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textMuted} />
          <Text style={styles.empty}>Couldn't load answers.</Text>
          <Pressable style={styles.retry} onPress={() => load(tab)}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : items === null ? (
        <View style={{ padding: spacing.xl, gap: spacing.md }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} style={{ height: 220, borderRadius: radius.lg }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.question_attempt_id}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            items.length ? (
              <Text style={styles.count}>
                {items.length} {tab === 'pending' ? 'answer' : 'graded answer'}
                {items.length === 1 ? '' : 's'}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Animated.View entering={FadeIn.duration(250)} exiting={FadeOutLeft.duration(250)} layout={LinearTransition}>
              <ReviewCard item={item} onGraded={onGraded} />
            </Animated.View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name={tab === 'pending' ? 'checkmark-done-outline' : 'document-text-outline'} size={30} color={colors.textFaint} />
              <Text style={styles.empty}>
                {tab === 'pending' ? 'All caught up — no essay answers waiting.' : 'Nothing graded yet.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function ReviewCard({
  item,
  onGraded,
}: {
  item: ReviewItem;
  onGraded: (item: ReviewItem, points: number, comment: string, finalScore: number | null, passed: boolean | null) => void;
}) {
  const [points, setPoints] = useState<number | null>(item.points_awarded);
  const [comment, setComment] = useState(item.teacher_comment ?? '');
  const [showModel, setShowModel] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = Array.from({ length: Math.min(item.max_points, 10) + 1 }, (_, i) => i);

  const save = async () => {
    if (points == null) {
      setError('Pick how many points this answer gets.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await reviewEssayAnswer(item.question_attempt_id, points, comment.trim());
      onGraded(item, points, comment.trim(), r.attempt_finalized ? r.attempt_score_percent : null, r.attempt_passed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Saving failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(item.student_name || item.student_email).charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.student} numberOfLines={1}>
            {item.student_name || item.student_email}
          </Text>
          <Text style={styles.when}>{formatWhen(item.reviewed_at || item.submitted_at)}</Text>
        </View>
        <Text style={styles.maxPoints}>
          / {item.max_points} pt{item.max_points === 1 ? '' : 's'}
        </Text>
      </View>

      <MathText text={item.prompt} color={colors.textMuted} fontSize={13} />
      {item.image_url ? (
        <ResolvedImage url={item.image_url} style={styles.image} containerStyle={styles.image} resizeMode="contain" />
      ) : null}

      {item.answer_image_url ? (
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel="Open the student's solution photo">
          <Text style={styles.answerLabel}>Student's solution (tap to zoom)</Text>
          <Image source={{ uri: item.answer_image_url }} style={styles.answerPhoto} resizeMode="contain" />
        </Pressable>
      ) : item.submitted_answer.startsWith('b2:') ? (
        <View style={styles.answerBox}>
          <Text style={styles.answerLabel}>Student's solution</Text>
          <Text style={styles.empty}>The photo link couldn't be loaded — pull to refresh.</Text>
        </View>
      ) : (
        <View style={styles.answerBox}>
          <Text style={styles.answerLabel}>Student's answer</Text>
          <MathText text={item.submitted_answer} color={colors.text} fontSize={15} />
        </View>
      )}
      <ImageViewerModal visible={zoom} url={item.answer_image_url} onClose={() => setZoom(false)} />

      {item.model_answer ? (
        <Pressable style={styles.modelToggle} onPress={() => setShowModel((v) => !v)} hitSlop={6}>
          <Ionicons name={showModel ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
          <Text style={styles.modelToggleText}>{showModel ? 'Hide' : 'Show'} model answer</Text>
        </Pressable>
      ) : null}
      {showModel && item.model_answer ? (
        <View style={styles.modelBox}>
          <MathText text={item.model_answer} color={colors.textMuted} fontSize={13} />
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Points</Text>
      <View style={styles.pointsRow}>
        <PointChip label="✕ 0" active={points === 0} tone="bad" onPress={() => setPoints(0)} />
        {options.slice(1, -1).map((n) => (
          <PointChip key={n} label={String(n)} active={points === n} onPress={() => setPoints(n)} />
        ))}
        <PointChip
          label={`✓ ${item.max_points}`}
          active={points === item.max_points}
          tone="good"
          onPress={() => setPoints(item.max_points)}
        />
      </View>

      <TextInput
        style={styles.comment}
        placeholder="Comment for the student (optional)"
        placeholderTextColor={colors.textFaint}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={2000}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PressableScale style={[styles.save, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} accessibilityRole="button">
        {saving ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.saveText}>{item.reviewed_at ? 'Update grade' : 'Save grade'}</Text>
        )}
      </PressableScale>
    </View>
  );
}

function PointChip({
  label,
  active,
  tone,
  onPress,
}: {
  label: string;
  active: boolean;
  tone?: 'good' | 'bad';
  onPress: () => void;
}) {
  const activeColor = tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pointChip, active && { backgroundColor: activeColor, borderColor: activeColor }]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      hitSlop={4}
    >
      <Text style={[styles.pointChipText, active && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    margin: spacing.xl,
    marginBottom: 0,
    padding: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontFamily: fonts.semiBold, fontSize: 13 },
  tabTextActive: { color: colors.onPrimary },
  count: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12.5, marginBottom: spacing.sm },
  center: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, marginTop: spacing.xl },
  empty: { color: colors.textMuted, fontFamily: fonts.regular, textAlign: 'center' },
  retry: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: spacing.xl },
  retryText: { color: colors.primary, fontFamily: fonts.semiBold },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${colors.violet}33`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontFamily: fonts.bold },
  student: { color: colors.text, fontFamily: fonts.semiBold, fontSize: 14 },
  when: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5 },
  maxPoints: { color: colors.accent, fontFamily: fonts.bold, fontSize: 13 },
  image: { width: '100%', aspectRatio: 1.6, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  answerBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  answerLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, marginBottom: 4 },
  answerPhoto: { width: '100%', aspectRatio: 0.75, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  modelToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  modelToggleText: { color: colors.primary, fontFamily: fonts.semiBold, fontSize: 12.5 },
  modelBox: { backgroundColor: `${colors.success}12`, borderRadius: radius.md, padding: spacing.sm },
  sectionLabel: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 12, marginTop: spacing.xs },
  pointsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pointChip: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  pointChipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  comment: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    fontFamily: fonts.regular,
    textAlignVertical: 'top',
  },
  error: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12.5 },
  save: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center', minHeight: 46 },
  saveText: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 15 },
});
