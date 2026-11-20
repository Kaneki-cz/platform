import React, { useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, Path, Polygon, Stop, Text as SvgText } from 'react-native-svg';

import { colors, fonts, gradientBrand, radius } from '@/constants/theme';
import type { VisualizationPayload } from '@/lib/types';

/**
 * Dispatches a backend VisualizationPayload (see docs/visualization_schema.md)
 * to the matching renderer. motion_diagram and free_body_diagram are real
 * animated SVG drawings (react-native-svg + Reanimated, both already in the
 * native build); anything else falls back to a labeled value card.
 */
export function VisualizationRenderer({ visualization }: { visualization: VisualizationPayload }) {
  switch (visualization.type) {
    case 'motion_diagram':
      return <MotionDiagram data={visualization.data as { t: number[]; x: number[]; y: number[] }} />;
    case 'free_body_diagram':
      return <FreeBodyDiagram data={visualization.data as any} />;
    case 'graph':
      return <KeyValueCard title="Result" data={visualization.data} />;
    default:
      return <KeyValueCard title={visualization.type} data={visualization.data} />;
  }
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

const PLOT_H = 190;
const PAD = 26;

/** Trajectory plot: the path draws itself left-to-right while a ball rides
 * its leading edge, then a Replay chip lets the student watch it again. */
function MotionDiagram({ data }: { data: { t: number[]; x: number[]; y: number[] } }) {
  const [width, setWidth] = useState(0);
  const [runId, setRunId] = useState(0);
  const progress = useSharedValue(0);
  const n = Math.min(data.x?.length ?? 0, data.y?.length ?? 0);

  const geom = useMemo(() => {
    if (!width || n < 2) return null;
    const maxX = Math.max(...data.x.slice(0, n), 1e-6);
    const maxY = Math.max(...data.y.slice(0, n), 1e-6);
    const w = width - PAD * 2;
    const h = PLOT_H - PAD * 2;
    // Same scale on both axes so the arc's real shape isn't distorted.
    const scale = Math.min(w / maxX, h / maxY);
    const px = data.x.slice(0, n).map((x) => PAD + x * scale);
    const py = data.y.slice(0, n).map((y) => PLOT_H - PAD - y * scale);
    let length = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) {
      length += Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
      cum.push(length);
    }
    const d = px.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${py[i].toFixed(1)}`).join(' ');
    let peak = 0;
    for (let i = 1; i < n; i++) if (data.y[i] > data.y[peak]) peak = i;
    return { px, py, cum, length, d, peak, groundY: PLOT_H - PAD };
  }, [width, n, data.x, data.y]);

  useEffect(() => {
    if (!geom) return;
    progress.value = 0;
    progress.value = withDelay(150, withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.cubic) }));
    return () => cancelAnimation(progress);
  }, [geom, runId, progress]);

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: geom ? geom.length * (1 - progress.value) : 0,
  }));

  const ballProps = useAnimatedProps(() => {
    if (!geom) return { cx: 0, cy: 0 };
    const target = progress.value * geom.length;
    let i = 1;
    while (i < geom.cum.length - 1 && geom.cum[i] < target) i++;
    const seg = geom.cum[i] - geom.cum[i - 1] || 1;
    const f = Math.min(1, Math.max(0, (target - geom.cum[i - 1]) / seg));
    return {
      cx: geom.px[i - 1] + (geom.px[i] - geom.px[i - 1]) * f,
      cy: geom.py[i - 1] + (geom.py[i] - geom.py[i - 1]) * f,
    };
  });

  const last = n - 1;
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Trajectory</Text>
        <Pressable onPress={() => setRunId((r) => r + 1)} style={styles.chip} hitSlop={8}>
          <Text style={styles.chipText}>↻ Replay</Text>
        </Pressable>
      </View>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: PLOT_H }}>
        {geom ? (
          <Svg width={width} height={PLOT_H}>
            <Defs>
              <SvgGradient id="trajGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={gradientBrand[0]} />
                <Stop offset="1" stopColor={gradientBrand[1]} />
              </SvgGradient>
            </Defs>
            <Line x1={PAD} y1={geom.groundY} x2={width - PAD / 2} y2={geom.groundY} stroke={colors.border} strokeWidth={1.5} />
            <Line x1={PAD} y1={geom.groundY} x2={PAD} y2={PAD / 2} stroke={colors.border} strokeWidth={1.5} />
            <Path d={geom.d} stroke={colors.surfaceAlt} strokeWidth={3} fill="none" strokeDasharray="4 6" />
            <AnimatedPath
              d={geom.d}
              stroke="url(#trajGrad)"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${geom.length} ${geom.length}`}
              animatedProps={pathProps}
            />
            <Line
              x1={geom.px[geom.peak]}
              y1={geom.py[geom.peak]}
              x2={geom.px[geom.peak]}
              y2={geom.groundY}
              stroke={colors.textFaint}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <SvgText x={geom.px[geom.peak]} y={geom.py[geom.peak] - 8} fill={colors.textMuted} fontSize={10} textAnchor="middle">
              {`h max ${data.y[geom.peak].toFixed(2)} m`}
            </SvgText>
            <AnimatedCircle r={7} fill={colors.accent} stroke={colors.background} strokeWidth={2} animatedProps={ballProps} />
          </Svg>
        ) : null}
      </View>
      {last >= 1 ? (
        <View style={styles.statRow}>
          <MiniStat label="Range" value={`${data.x[last].toFixed(2)} m`} />
          <MiniStat label="Max height" value={`${Math.max(...data.y.slice(0, n)).toFixed(2)} m`} />
          <MiniStat label="Flight time" value={`${data.t[last].toFixed(2)} s`} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const FBD_SIZE = 220;

/** Force vectors from a central body: each component arrow grows out first,
 * then the resultant (in the brand gradient) sweeps in on top. */
function FreeBodyDiagram({ data }: { data: { components: { fx: number; fy: number }; result: Record<string, number> } }) {
  const fx = Number(data?.components?.fx ?? 0);
  const fy = Number(data?.components?.fy ?? 0);
  const c = FBD_SIZE / 2;
  const maxMag = Math.max(Math.abs(fx), Math.abs(fy), Math.hypot(fx, fy), 1e-6);
  const unit = (FBD_SIZE / 2 - 30) / maxMag;
  // SVG y grows downward, so a positive Fy points up on screen.
  const ex = { x: c + fx * unit, y: c };
  const ey = { x: c, y: c - fy * unit };
  const en = { x: c + fx * unit, y: c - fy * unit };

  const compProgress = useSharedValue(0);
  const netProgress = useSharedValue(0);
  useEffect(() => {
    compProgress.value = withDelay(150, withTiming(1, { duration: 700, easing: Easing.out(Easing.back(1.4)) }));
    netProgress.value = withDelay(850, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [compProgress, netProgress]);

  const compStyle = useAnimatedProps(() => ({ opacity: compProgress.value }));
  const netStyle = useAnimatedProps(() => ({ opacity: netProgress.value }));

  const xLine = useAnimatedProps(() => ({ x2: c + (ex.x - c) * compProgress.value }));
  const yLine = useAnimatedProps(() => ({ y2: c + (ey.y - c) * compProgress.value }));
  const nLine = useAnimatedProps(() => ({
    x2: c + (en.x - c) * netProgress.value,
    y2: c + (en.y - c) * netProgress.value,
  }));

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.card}>
      <Text style={styles.cardTitle}>Free-body diagram</Text>
      <View style={{ alignItems: 'center' }}>
        <Svg width={FBD_SIZE} height={FBD_SIZE}>
          <Defs>
            <SvgGradient id="netGrad" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={gradientBrand[0]} />
              <Stop offset="1" stopColor={gradientBrand[1]} />
            </SvgGradient>
          </Defs>
          <Line x1={10} y1={c} x2={FBD_SIZE - 10} y2={c} stroke={colors.border} strokeDasharray="3 5" />
          <Line x1={c} y1={10} x2={c} y2={FBD_SIZE - 10} stroke={colors.border} strokeDasharray="3 5" />
          {fx !== 0 ? (
            <AnimatedG animatedProps={compStyle}>
              <AnimatedLine x1={c} y1={c} y2={c} stroke={colors.accent} strokeWidth={3} animatedProps={xLine} />
              <Arrowhead from={{ x: c, y: c }} to={ex} color={colors.accent} />
              <SvgText x={ex.x} y={ex.y + 18} fill={colors.accent} fontSize={11} textAnchor="middle">{`Fx ${fx}`}</SvgText>
            </AnimatedG>
          ) : null}
          {fy !== 0 ? (
            <AnimatedG animatedProps={compStyle}>
              <AnimatedLine x1={c} y1={c} x2={c} stroke={colors.success} strokeWidth={3} animatedProps={yLine} />
              <Arrowhead from={{ x: c, y: c }} to={ey} color={colors.success} />
              <SvgText x={ey.x + 8} y={ey.y + (fy > 0 ? -4 : 14)} fill={colors.success} fontSize={11}>{`Fy ${fy}`}</SvgText>
            </AnimatedG>
          ) : null}
          {fx !== 0 && fy !== 0 ? (
            <AnimatedG animatedProps={netStyle}>
              <AnimatedLine x1={c} y1={c} stroke="url(#netGrad)" strokeWidth={4} strokeLinecap="round" animatedProps={nLine} />
              <Arrowhead from={{ x: c, y: c }} to={en} color={gradientBrand[1]} size={11} />
            </AnimatedG>
          ) : null}
          <Circle cx={c} cy={c} r={13} fill={colors.surface} stroke={colors.primary} strokeWidth={2} />
        </Svg>
      </View>
      <View style={styles.statRow}>
        {Object.entries(data?.result ?? {}).map(([k, v]) => (
          <MiniStat key={k} label={prettyKey(k)} value={typeof v === 'number' ? formatNum(v) : String(v)} />
        ))}
      </View>
    </Animated.View>
  );
}

const AnimatedLine = Animated.createAnimatedComponent(Line);

function Arrowhead({ from, to, color, size = 9 }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string; size?: number }) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const p = (a: number) => `${to.x - size * Math.cos(angle + a)},${to.y - size * Math.sin(angle + a)}`;
  return <Polygon points={`${to.x},${to.y} ${p(0.45)} ${p(-0.45)}`} fill={color} />;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function prettyKey(k: string) {
  return k
    .replace(/_N$/, ' (N)')
    .replace(/_deg$/, ' (°)')
    .replace(/_m_s2$/, ' (m/s²)')
    .replace(/_/g, ' ')
    .replace(/^\w/, (ch) => ch.toUpperCase());
}

function formatNum(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function KeyValueCard({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => k !== 'kind');
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.statRow}>
        {entries.map(([k, v]) => (
          <MiniStat key={k} label={prettyKey(k)} value={typeof v === 'number' ? formatNum(v) : JSON.stringify(v)} />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: `${colors.violet}33`,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontFamily: fonts.bold, marginBottom: 6, color: colors.text },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: `${colors.primary}59`,
  },
  chipText: { color: colors.primary, fontSize: 12, fontFamily: fonts.semiBold },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  miniStat: {
    flexGrow: 1,
    minWidth: 90,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  miniValue: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  miniLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11 },
});
