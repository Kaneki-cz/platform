import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { GradeEssaysBanner } from '@/components/GradeEssaysBanner';
import { MathText } from '@/components/MathText';
import { Skeleton, enterStagger, useCountUp } from '@/components/motion';
import { getExamAnalytics } from '@/lib/api';
import { cardShadow, colors, fonts, radius, spacing } from '@/constants/theme';
import type { ExamAnalytics, QuestionAnalytics } from '@/lib/types';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Bar colour by how many got it right: red under 40%, orange under 70%,
 * green otherwise — the hardest questions jump out at a glance. */
function rateColor(rate: number) {
  if (rate < 0.4) return colors.danger;
  if (rate < 0.7) return colors.accent;
  return colors.success;
}

/**
 * Teacher-facing exam analytics: pass rate, average score/time, then every
 * question hardest-first with its correct rate, the wrong answer most
 * students picked, and the full option breakdown — so a teacher can see
 * which idea needs re-explaining. Reached from the exam card on
 * app/admin/course/[id]/exams.tsx.
 */
export default function ExamAnalyticsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ExamAnalytics | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setFailed(false);
      getExamAnalytics(id)
        .then(setData)
        .catch(() => setFailed(true));
    }, [id]),
  );

  if (failed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="cloud-offline-outline" size={28} color={colors.textMuted} />
        <Text style={styles.empty}>Couldn't load analytics. Check your connection and reopen this screen.</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.container, { padding: spacing.xl, gap: spacing.md }]}>
        <Skeleton style={{ height: 110, borderRadius: radius.lg }} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 120, borderRadius: radius.lg }} />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xxl }}
      data={data.attempt_count > 0 ? data.questions : []}
      keyExtractor={(q) => q.question_id}
      ListHeaderComponent={
        <View>
          <Text style={styles.title} numberOfLines={2}>
            {data.exam_title}
          </Text>
          <GradeEssaysBanner examId={id} count={data.pending_reviews} style={{ marginBottom: spacing.md }} />
          <Animated.View entering={FadeInDown.duration(350)} style={styles.summaryCard}>
            <Stat label="Pass rate" value={data.pass_rate} suffix="%" scale={100} />
            <Stat label="Avg score" value={data.average_score} suffix="%" />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatDuration(data.average_duration_seconds)}</Text>
              <Text style={styles.statLabel}>Avg time</Text>
            </View>
          </Animated.View>
          <Text style={styles.meta}>
            {data.attempt_count} attempt{data.attempt_count === 1 ? '' : 's'} by {data.student_count} student
            {data.student_count === 1 ? '' : 's'} · pass mark {data.passing_percent}%
          </Text>
          {data.attempt_count > 0 ? <Text style={styles.sectionTitle}>Questions, hardest first</Text> : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <Animated.View entering={enterStagger(index, 150)}>
          {item.question_type === 'essay' ? (
            <EssayCard q={item} index={index} examId={id} />
          ) : (
            <QuestionCard q={item} index={index} />
          )}
        </Animated.View>
      )}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Ionicons name="bar-chart-outline" size={28} color={colors.textFaint} />
          <Text style={styles.empty}>No submitted attempts yet. Numbers show up here once students finish this exam.</Text>
        </View>
      }
    />
  );
}

function Stat({ label, value, suffix, scale = 1 }: { label: string; value: number | null; suffix: string; scale?: number }) {
  const shown = useCountUp(value == null ? 0 : Math.round(value * scale));
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value == null ? '—' : `${shown}${suffix}`}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Essay questions are graded by the teacher, so "% correct" means nothing
 * until they're graded: show graded / waiting counts and the average mark. */
function EssayCard({ q, index, examId }: { q: QuestionAnalytics; index: number; examId: string }) {
  const graded = q.graded_count ?? 0;
  const pending = q.pending_count ?? 0;
  const max = q.points ?? 1;
  const pct = Math.round(q.correct_rate * 100);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.rank}>#{index + 1} · Essay</Text>
        {graded > 0 && q.average_points != null ? (
          <Text style={[styles.rate, { color: rateColor(q.correct_rate) }]}>
            avg {Math.round(q.average_points * 10) / 10}/{max} pts
          </Text>
        ) : (
          <Text style={[styles.rate, { color: colors.textMuted }]}>Not graded yet</Text>
        )}
      </View>
      <MathText text={q.prompt} color={colors.text} fontSize={14} />
      {graded > 0 ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: rateColor(q.correct_rate) }]} />
        </View>
      ) : null}
      <Text style={styles.metaSmall}>
        {graded} graded · {pending} waiting for you
      </Text>
      {pending > 0 ? <GradeEssaysBanner examId={examId} count={pending} style={{ marginTop: spacing.sm }} /> : null}
    </View>
  );
}

function QuestionCard({ q, index }: { q: QuestionAnalytics; index: number }) {
  const pct = Math.round(q.correct_rate * 100);
  const color = rateColor(q.correct_rate);
  const maxCount = Math.max(1, ...q.choice_counts.map((c) => c.count));
  const correctKey = q.correct_answer.trim().toLowerCase();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.rank}>#{index + 1}</Text>
        <Text style={[styles.rate, { color }]}>{pct}% correct</Text>
      </View>
      <MathText text={q.prompt} color={colors.text} fontSize={14} />
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>

      {q.choice_counts.length > 0 ? (
        <View style={styles.choices}>
          {q.choice_counts.map((c) => {
            const isCorrect = c.answer.trim().toLowerCase() === correctKey;
            return (
              <View key={c.answer} style={styles.choiceRow}>
                <Ionicons
                  name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={isCorrect ? colors.success : colors.textFaint}
                />
                <Text style={[styles.choiceLabel, isCorrect && { color: colors.success }]} numberOfLines={1}>
                  {c.label ?? c.answer}
                </Text>
                <View style={styles.choiceTrack}>
                  <View
                    style={[
                      styles.choiceFill,
                      { width: `${(c.count / maxCount) * 100}%`, backgroundColor: isCorrect ? colors.success : colors.textFaint },
                    ]}
                  />
                </View>
                <Text style={styles.choiceCount}>{c.count}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.metaSmall}>Correct answer: {q.correct_answer}</Text>
      )}

      {q.most_common_wrong && q.most_common_wrong.count > 0 ? (
        <View style={styles.wrongNote}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.accent} />
          <Text style={styles.wrongText}>
            Most common wrong answer: {q.most_common_wrong.label ?? q.most_common_wrong.answer} ({q.most_common_wrong.count})
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.md },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: `${colors.violet}33`,
    paddingVertical: spacing.lg,
    ...cardShadow,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontFamily: fonts.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textMuted, marginTop: 2 },
  meta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: spacing.sm, textAlign: 'center' },
  metaSmall: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: spacing.sm },
  sectionTitle: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  rank: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 12 },
  rate: { fontFamily: fonts.bold, fontSize: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  choices: { marginTop: spacing.md, gap: 6 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  choiceLabel: { width: '38%', color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  choiceTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  choiceFill: { height: 6, borderRadius: 3 },
  choiceCount: { width: 24, textAlign: 'right', color: colors.textMuted, fontFamily: fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  wrongNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: `${colors.accent}14`,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  wrongText: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 12.5 },
  emptyBox: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.regular, lineHeight: 20 },
});
