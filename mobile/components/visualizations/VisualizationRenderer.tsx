import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import type { VisualizationPayload } from '@/lib/types';

/**
 * Dispatches a backend VisualizationPayload (see docs/visualization_schema.md)
 * to the matching renderer. These are intentionally simple (numeric/text
 * summaries) for now — swap in a real charting/SVG library (e.g.
 * react-native-svg, victory-native) per type as Phase 6 work continues.
 */
export function VisualizationRenderer({ visualization }: { visualization: VisualizationPayload }) {
  switch (visualization.type) {
    case 'motion_diagram':
      return <MotionDiagram data={visualization.data as { t: number[]; x: number[]; y: number[] }} />;
    case 'graph':
      return <KeyValueCard title="Result" data={visualization.data} />;
    case 'free_body_diagram':
      return <FreeBodyDiagram data={visualization.data as any} />;
    default:
      return <KeyValueCard title={visualization.type} data={visualization.data} />;
  }
}

function MotionDiagram({ data }: { data: { t: number[]; x: number[]; y: number[] } }) {
  const last = data.x.length - 1;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>📈 Motion diagram ({data.t.length} points)</Text>
      <Text style={styles.row}>Start: (x=0, y=0) at t=0s</Text>
      {last >= 0 ? (
        <Text style={styles.row}>
          End: (x={data.x[last].toFixed(2)}, y={data.y[last].toFixed(2)}) at t={data.t[last].toFixed(2)}s
        </Text>
      ) : null}
      <Text style={styles.hint}>Full path plotting renders here once a charting library is wired up.</Text>
    </View>
  );
}

function FreeBodyDiagram({ data }: { data: { components: { fx: number; fy: number }; result: Record<string, number> } }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>➡️ Free-body diagram</Text>
      <Text style={styles.row}>
        Net force: Fx={data.components.fx}, Fy={data.components.fy}
      </Text>
      {Object.entries(data.result).map(([k, v]) => (
        <Text key={k} style={styles.row}>
          {k}: {typeof v === 'number' ? v.toFixed(3) : String(v)}
        </Text>
      ))}
    </View>
  );
}

function KeyValueCard({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {Object.entries(data).map(([k, v]) => (
        <Text key={k} style={styles.row}>
          {k}: {typeof v === 'number' ? v.toFixed(3) : JSON.stringify(v)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontWeight: '700', marginBottom: 6, color: colors.text },
  row: { color: colors.textMuted, marginTop: 2 },
  hint: { color: colors.textFaint, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
});
