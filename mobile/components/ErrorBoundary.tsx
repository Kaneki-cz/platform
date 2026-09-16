import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
  /** Shown above the error so a screen-specific boundary can say what broke
   * (e.g. "Video player crashed") instead of a bare stack trace. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort crash catcher for a screen/section that might throw during
 * render. Without this, an uncaught render-time error unmounts the WHOLE
 * screen with zero feedback — the exact symptom reported after adding
 * expo-camera/react-native-svg alongside expo-video in the same native
 * build (a lesson's video slot going totally blank and staying that way,
 * see the "opening a lesson freezes on a blank screen" report). Shows the
 * actual error message + stack on-screen instead, so the next report is a
 * screenshot with the real cause on it rather than another guess.
 *
 * Kept permanently once added, not ripped out after this is diagnosed — a
 * screen crashing to a legible message beats an unrecoverable blank one
 * either way.
 *
 * Note: this only catches JS-level render/lifecycle errors (React's error
 * boundary contract). It can NOT catch a native-level crash (e.g. a native
 * view manager segfaulting) — if the screen still goes blank with nothing
 * shown even wrapped in this, that itself is useful information: it rules
 * out a JS exception and points at a native-level conflict instead.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={styles.container}>
          {this.props.label ? <Text style={styles.label}>{this.props.label}</Text> : null}
          <Text style={styles.message}>{this.state.error.message}</Text>
          {this.state.error.stack ? <Text style={styles.stack}>{this.state.error.stack}</Text> : null}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.lg, backgroundColor: colors.background },
  label: { color: colors.danger, fontWeight: '700', fontSize: 16, marginBottom: 8 },
  message: { color: colors.text, fontWeight: '600', marginBottom: 12, fontSize: 14 },
  stack: { color: colors.textMuted, fontSize: 11 },
});
