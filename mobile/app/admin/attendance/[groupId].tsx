import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, getGroupAttendance, scanAttendance } from '@/lib/api';
import { colors, radius, spacing } from '@/constants/theme';
import type { AttendanceRow } from '@/lib/types';

type ScanFeedback =
  | { kind: 'success'; name: string; alreadyMarked: boolean }
  | { kind: 'error'; message: string }
  | null;

/** Instructor/admin: pick-a-group-first attendance scanner. The group (and
 * the teacher who owns it) is already fixed by the time this screen opens —
 * see the "📷 Scan attendance" link on each group row in
 * app/admin/subject/[id].tsx, which passes groupId/teacherId/groupName as
 * route params. Points the camera at a student's own QR (see
 * app/(tabs)/profile.tsx) and calls POST /api/v1/attendance/scan for every
 * code it reads, showing a flash of feedback and refreshing the present
 * list below — meant to be left open and pointed at student after student
 * for a whole session, not used once and closed. */
export default function AttendanceScannerScreen() {
  const { groupId, teacherId, groupName } = useLocalSearchParams<{
    groupId: string;
    teacherId: string;
    groupName?: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [present, setPresent] = useState<AttendanceRow[]>([]);
  const [loadingPresent, setLoadingPresent] = useState(true);
  // Guards against the camera firing onBarcodeScanned many times a second
  // for the same still-visible code — re-armed a beat after each scan so a
  // NEW code is picked up right away instead of being locked out too.
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  const loadPresent = useCallback(() => {
    if (!teacherId || !groupId) return;
    getGroupAttendance(teacherId, groupId)
      .then((data) => setPresent(data.present))
      .catch(() => {})
      .finally(() => setLoadingPresent(false));
  }, [teacherId, groupId]);

  React.useEffect(() => {
    loadPresent();
  }, [loadPresent]);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!groupId) return;
      const now = Date.now();
      // Same code scanned again within 4s — the camera is almost certainly
      // still pointed at the same student's screen; ignore the repeat
      // instead of re-hitting the server on every frame.
      if (lastScanRef.current && lastScanRef.current.code === data && now - lastScanRef.current.at < 4000) {
        return;
      }
      lastScanRef.current = { code: data, at: now };
      setScanning(false);
      scanAttendance(data, groupId)
        .then((result) => {
          setFeedback({
            kind: 'success',
            name: result.full_name || result.email,
            alreadyMarked: result.already_marked,
          });
          loadPresent();
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error('scanAttendance failed:', e instanceof ApiError ? { status: e.status, message: e.message } : e);
          setFeedback({ kind: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong.' });
        })
        .finally(() => {
          setTimeout(() => setScanning(true), 1200);
        });
    },
    [groupId, loadPresent],
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera access is needed to scan attendance codes.</Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.groupTitle}>{groupName || 'Group'}</Text>

      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanning ? onScanned : undefined}
        />
        {!scanning ? (
          <View style={styles.scanOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>

      {feedback ? (
        <View style={[styles.feedbackBox, feedback.kind === 'error' ? styles.feedbackError : styles.feedbackSuccess]}>
          <Text style={styles.feedbackText}>
            {feedback.kind === 'success'
              ? feedback.alreadyMarked
                ? `✓ ${feedback.name} — already marked today`
                : `✓ ${feedback.name} — marked present`
              : `✕ ${feedback.message}`}
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Point the camera at a student's QR code on their profile screen.</Text>
      )}

      <Text style={styles.presentTitle}>Present today ({present.length})</Text>
      {loadingPresent ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : (
        <FlatList
          data={present}
          keyExtractor={(row) => row.user_id}
          style={styles.presentList}
          ListEmptyComponent={<Text style={styles.empty}>No one scanned yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.presentRow}>
              <Text style={styles.presentName} numberOfLines={1}>
                {item.full_name || item.email}
              </Text>
              <Text style={styles.presentTime}>
                {new Date(item.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permissionText: { color: colors.text, textAlign: 'center', marginBottom: spacing.lg, fontSize: 15 },
  permissionButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 14 },
  permissionButtonText: { color: colors.onPrimary, fontWeight: '700' },
  groupTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.md },
  cameraWrap: {
    height: 300,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
  feedbackBox: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1 },
  feedbackSuccess: { backgroundColor: colors.surfaceAlt, borderColor: colors.success + '55' },
  feedbackError: { backgroundColor: colors.dangerSurface, borderColor: colors.danger + '55' },
  feedbackText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  presentTitle: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: spacing.lg, marginBottom: spacing.sm },
  presentList: { flex: 1 },
  presentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  presentName: { color: colors.text, fontSize: 14, fontWeight: '500', flex: 1, marginEnd: 8 },
  presentTime: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textFaint, marginTop: 8 },
});
