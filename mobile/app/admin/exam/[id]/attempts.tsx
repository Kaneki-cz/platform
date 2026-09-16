import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { getExamAttempts } from '@/lib/api';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import type { ExamAttemptRow, ExamAttemptsData } from '@/lib/types';

// Below this, an attempt's average time-per-question is short enough that
// this screen calls it out visually too — purely a color cue on top of the
// server's own is_fast flag (see FAST_ATTEMPT_SECONDS_PER_QUESTION on the
// backend), never something computed independently here.
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Teacher-facing "grades" screen for one exam — every completed attempt,
 * newest first, with score/duration and a flag on suspiciously fast ones.
 * Reached from the exam's card on app/admin/course/[id]/exams.tsx.
 */
export default function ExamAttemptsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ExamAttemptsData | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      getExamAttempts(id)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, [id]),
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data || data.attempts.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { padding: spacing.xl }]}>
        <Text style={styles.empty}>
          No completed attempts yet — this fills in automatically once a student finishes this exam.
        </Text>
      </View>
    );
  }

  const fastCount = data.attempts.filter((a) => a.is_fast).length;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
      data={data.attempts}
      keyExtractor={(a) => a.attempt_id}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>{data.exam_title}</Text>
          <Text style={styles.summary}>
            {data.attempts.length} completed attempt{data.attempts.length === 1 ? '' : 's'} · {data.question_count}{' '}
            question{data.question_count === 1 ? '' : 's'}
            {fastCount > 0 ? ` · ${fastCount} flagged as suspiciously fast` : ''}
          </Text>
        </>
      }
      renderItem={({ item }) => <AttemptRow attempt={item} />}
    />
  );
}

function AttemptRow({ attempt }: { attempt: ExamAttemptRow }) {
  return (
    <View style={[styles.row, attempt.is_fast && styles.rowFast]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {attempt.full_name?.trim() || attempt.email}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {attempt.email}
          </Text>
        </View>
        <View style={styles.scoreBlock}>
          <Text style={[styles.score, attempt.passed ? styles.scorePassed : styles.scoreFailed]}>
            {attempt.score_percent != null ? `${Math.round(attempt.score_percent)}%` : '—'}
          </Text>
          <Text style={styles.scoreLabel}>{attempt.passed ? 'passed' : 'failed'}</Text>
        </View>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.metaText}>⏱ {formatDuration(attempt.duration_seconds)}</Text>
        <Text style={styles.metaText}>{formatDateTime(attempt.submitted_at)}</Text>
        {attempt.is_fast ? (
          <View style={styles.fastTag}>
            <Text style={styles.fastTagText}>⚠ suspiciously fast</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textFaint, textAlign: 'center', lineHeight: 20 },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, marginBottom: 4 },
  summary: { fontSize: 12, color: colors.textFaint, marginBottom: 14 },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    ...cardShadow,
  },
  rowFast: { borderColor: colors.danger + '55' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, color: colors.text, fontFamily: fonts.bold },
  email: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  scoreBlock: { alignItems: 'flex-end' },
  score: { fontSize: 18, fontFamily: fonts.bold },
  scorePassed: { color: colors.success },
  scoreFailed: { color: colors.danger },
  scoreLabel: { fontSize: 10, color: colors.textFaint, marginTop: 1 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' },
  metaText: { fontSize: 11.5, color: colors.textMuted },
  fastTag: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fastTagText: { fontSize: 10.5, color: colors.danger, fontFamily: fonts.bold },
});
