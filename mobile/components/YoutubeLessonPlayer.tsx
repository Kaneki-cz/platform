import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';

import type { LessonVideoPlayerHandle } from './LessonVideoPlayer';

interface Props {
  videoId: string;
  onProgress?: (percent: number) => void;
  onDurationKnown?: (seconds: number) => void;
  pauseAtSeconds?: number | null;
  onReachBoundary?: () => void;
}

/**
 * Same role as the mp4 player in LessonVideoPlayer.tsx, but backed by the
 * YouTube iframe player instead of expo-video — used whenever a lesson's
 * video_url is a YouTube link (see LessonVideoPlayer's dispatcher and
 * lib/youtube.ts's extractYoutubeId). Exposes the identical
 * LessonVideoPlayerHandle ref (seekTo/play/pause) and the identical
 * onProgress/onDurationKnown/pauseAtSeconds/onReachBoundary props, so
 * app/lessons/[id].tsx's segment-quiz logic works the same regardless of
 * which player is actually mounted.
 *
 * IMPORTANT — this uses YouTube's own native player controls, not a custom
 * overlay. Two attempts at drawing our own play/pause + progress bar on top
 * of the react-native-youtube-iframe WebView (including the documented
 * `androidLayerType: 'software'` fix) both failed on this app's target
 * devices — the WebView keeps compositing above sibling React Native views
 * regardless. Fighting that further isn't worth the reliability risk, so
 * this deliberately uses YouTube's real player chrome, which is proven to
 * actually play video. That does mean YouTube's own "Watch on YouTube" /
 * share affordances are visible on the pause screen — there is no player
 * parameter that removes those; it's a hard YouTube-side limitation, not a
 * bug in this file.
 *
 * Fullscreen is handled separately from that native chrome: a small button
 * rendered BELOW the video (not stacked on top of it) opens a real
 * device-filling <Modal>, sidestepping the overlay z-order problem entirely
 * since nothing here draws over the WebView. The YoutubePlayer instance
 * remounts when switching in/out of the Modal (React can't move a live
 * component between the inline tree and a Modal's own tree without a
 * portal), so `lastKnownSecondsRef` seeks the new instance back to roughly
 * where playback was, instead of restarting from 0:00.
 *
 * The YouTube iframe player doesn't emit a continuous "current time" event
 * the way expo-video's timeUpdate does, so this polls getCurrentTime() on a
 * 1s interval while playing — same cadence as the mp4 player's
 * timeUpdateEventInterval, close enough for the auto-pause-at-boundary
 * feature to feel just as snappy.
 */
export const YoutubeLessonPlayer = forwardRef<LessonVideoPlayerHandle, Props>(function YoutubeLessonPlayer(
  { videoId, onProgress, onDurationKnown, pauseAtSeconds, onReachBoundary },
  ref,
) {
  const playerRef = useRef<{
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
    getCurrentTime: () => Promise<number>;
    getDuration: () => Promise<number>;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const durationRef = useRef(0);
  const durationReportedRef = useRef(false);
  // Used to resume near the right spot after the player remounts when
  // entering/leaving fullscreen (see the component doc comment above).
  const lastKnownSecondsRef = useRef(0);
  // Same re-fire guard as the mp4 player: prevents onReachBoundary from
  // firing on every poll tick while paused at (or scrubbed back across) the
  // same boundary; reset whenever the caller hands us a new pauseAtSeconds,
  // and also whenever seekTo() lands before the current boundary (a
  // same-segment retry after a failed quiz doesn't change pauseAtSeconds,
  // so the effect below alone wouldn't catch that case).
  const boundaryFiredRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (seconds: number) => {
        playerRef.current?.seekTo(seconds, true);
        lastKnownSecondsRef.current = seconds;
        if (pauseAtSeconds != null && seconds < pauseAtSeconds) {
          boundaryFiredRef.current = false;
        }
      },
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
    }),
    [pauseAtSeconds],
  );

  useEffect(() => {
    boundaryFiredRef.current = false;
  }, [pauseAtSeconds]);

  const onReady = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log('YoutubeLessonPlayer status: ready, videoId:', videoId);
    // Restores position after a remount (fullscreen toggle) — a no-op the
    // very first time a lesson opens, since lastKnownSecondsRef starts at 0.
    if (lastKnownSecondsRef.current > 0) {
      playerRef.current?.seekTo(lastKnownSecondsRef.current, true);
    }
    if (durationReportedRef.current) return;
    const d = await playerRef.current?.getDuration();
    if (d) {
      durationReportedRef.current = true;
      durationRef.current = d;
      onDurationKnown?.(d);
    }
  }, [onDurationKnown, videoId]);

  // react-native-youtube-iframe's error codes: 2 = invalid videoId, 5 = HTML5
  // player error, 100 = video not found/removed/private, 101 & 150 = the
  // video owner has disabled embedding for THIS specific video (each video
  // needs "Allow embedding" turned on separately in YouTube Studio — it is
  // not a one-time, channel-wide setting).
  const onError = useCallback(
    (error: string) => {
      // eslint-disable-next-line no-console
      console.log('YoutubeLessonPlayer status: error', error, 'videoId:', videoId);
    },
    [videoId],
  );

  useEffect(() => {
    if (!playing) return undefined;
    const interval = setInterval(async () => {
      const current = await playerRef.current?.getCurrentTime();
      if (current == null) return;
      lastKnownSecondsRef.current = current;

      if (durationRef.current > 0) {
        const percent = Math.min(100, Math.round((current / durationRef.current) * 100));
        onProgress?.(percent);
      }

      if (pauseAtSeconds != null && !boundaryFiredRef.current && current >= pauseAtSeconds) {
        boundaryFiredRef.current = true;
        playerRef.current?.seekTo(pauseAtSeconds, true);
        lastKnownSecondsRef.current = pauseAtSeconds;
        setPlaying(false);
        // Fullscreen here is our own RN <Modal> (see the component doc
        // comment above) — it doesn't contain app/lessons/[id].tsx's segment
        // quiz overlay, so leaving it up would hide the question exactly
        // like expo-video's native fullscreen does for uploaded videos. Drop
        // back to the inline view the moment a question is due instead of
        // requiring the viewer to notice and tap the shrink button
        // themselves.
        setFullscreen(false);
        onReachBoundary?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [playing, pauseAtSeconds, onProgress, onReachBoundary]);

  // Keeps our `playing` state (used for the polling interval above, and for
  // resuming correctly after a fullscreen remount) in sync with taps on
  // YouTube's own native play/pause button.
  const onChangeState = useCallback(
    (state: string) => {
      if (state === 'playing') setPlaying(true);
      else if (state === 'paused') setPlaying(false);
      else if (state === 'ended') onProgress?.(100);
    },
    [onProgress],
  );

  // Inline box: standard 16:9 sized to the available width (screen width
  // minus the lesson screen's own 20px side padding — see
  // app/lessons/[id].tsx's contentContainerStyle). Fullscreen box: same
  // 16:9 math but against the full window width, letterboxed (centered)
  // inside a full-screen black Modal rather than cropped to fill it —
  // cropping a non-16:9 device screen would zoom into the video and cut
  // off part of the picture, the exact problem already fixed once for the
  // inline box.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const inlineWidth = windowWidth - 40;
  const inlineHeight = Math.round(inlineWidth * (9 / 16));
  const fullscreenWidth = windowWidth;
  const fullscreenHeight = Math.round(fullscreenWidth * (9 / 16));

  const playerWidth = fullscreen ? fullscreenWidth : inlineWidth;
  const playerHeight = fullscreen ? fullscreenHeight : inlineHeight;

  const player = (
    <View style={{ width: playerWidth }}>
      <View style={[styles.wrapper, { width: playerWidth, height: playerHeight }]}>
        <YoutubePlayer
          ref={playerRef}
          height={playerHeight}
          width={playerWidth}
          play={playing}
          videoId={videoId}
          onReady={onReady}
          onChangeState={onChangeState}
          onError={onError}
          webViewProps={{ mediaPlaybackRequiresUserAction: false }}
          initialPlayerParams={{ modestbranding: true, rel: false }}
        />
      </View>

      {/* Deliberately NOT overlaid on top of the video (see the component
          doc comment) — this lives in normal document flow below it, so it
          never has to fight the WebView for z-order. */}
      <Pressable style={styles.fullscreenRow} onPress={() => setFullscreen((f) => !f)} hitSlop={8}>
        <Text style={styles.fullscreenIcon}>{fullscreen ? '⤡' : '⤢'}</Text>
        <Text style={styles.fullscreenLabel}>{fullscreen ? 'تصغير' : 'ملء الشاشة'}</Text>
      </Pressable>
    </View>
  );

  if (fullscreen) {
    return (
      <Modal visible animationType="fade" onRequestClose={() => setFullscreen(false)} statusBarTranslucent>
        <View style={[styles.fullscreenModal, { height: windowHeight }]}>{player}</View>
      </Modal>
    );
  }

  return player;
});

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  fullscreenModal: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 4,
  },
  fullscreenIcon: { color: '#6b7280', fontSize: 15 },
  fullscreenLabel: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
});
