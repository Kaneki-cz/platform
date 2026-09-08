import { useVideoPlayer, VideoView } from 'expo-video';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { extractYoutubeId } from '@/lib/youtube';

import { YoutubeLessonPlayer } from './YoutubeLessonPlayer';

export interface LessonVideoPlayerHandle {
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

interface Props {
  url: string;
  onProgress?: (percent: number) => void;
  /** Once known (first timeUpdate after the video loads), the player's
   * total length in seconds — lets the caller resolve a "no specific pause
   * point" segment (pause_at_seconds: null) to a real boundary at the very
   * end of the video. */
  onDurationKnown?: (seconds: number) => void;
  /** Playback auto-pauses (and snaps exactly back to this second) the first
   * time it reaches this point, then fires onReachBoundary once. Pass a new
   * value (or null to disable) to re-arm it — e.g. once the caller advances
   * to the next segment after this one is passed. */
  pauseAtSeconds?: number | null;
  onReachBoundary?: () => void;
}

/**
 * Real video playback for a lecture. Dispatches to one of two
 * implementations based on `url`:
 *  - a YouTube link (youtube.com/watch?v=..., youtu.be/..., etc.) ->
 *    YoutubeLessonPlayer, which embeds the YouTube iframe player. This is
 *    the recommended way to host lecture videos now — playback comes
 *    straight from YouTube's own infrastructure instead of depending on our
 *    own server's upload storage and home-internet connection.
 *  - anything else (an uploaded file's /media/videos/... URL, or any other
 *    direct video link) -> the original expo-video-based player, unchanged.
 * Both branches expose the exact same LessonVideoPlayerHandle ref
 * (seekTo/play/pause) and the same onProgress/onDurationKnown/
 * pauseAtSeconds/onReachBoundary props, so app/lessons/[id].tsx's
 * segment-quiz orchestration doesn't need to know or care which one is
 * actually mounted for a given lesson.
 *
 * No hooks live directly in this dispatcher — it just picks which child to
 * render and forwards `ref` straight through — so conditionally returning
 * one branch or the other here doesn't run into React's rules-of-hooks.
 */
export const LessonVideoPlayer = forwardRef<LessonVideoPlayerHandle, Props>(function LessonVideoPlayer(props, ref) {
  const youtubeId = extractYoutubeId(props.url);
  if (youtubeId) {
    return (
      <YoutubeLessonPlayer
        ref={ref}
        videoId={youtubeId}
        onProgress={props.onProgress}
        onDurationKnown={props.onDurationKnown}
        pauseAtSeconds={props.pauseAtSeconds}
        onReachBoundary={props.onReachBoundary}
      />
    );
  }
  return <Mp4LessonPlayer ref={ref} {...props} />;
});

/** The original expo-video-based implementation — kept for lessons whose
 * video_url is an uploaded file (/media/videos/...) or any other direct
 * (non-YouTube) video link. Unchanged from before the YouTube dispatch
 * above was added. useVideoPlayer must run unconditionally, which is why
 * this lives in its own component rather than inline in the dispatcher. */
// A patchy home-internet connection (see the conversation with the
// instructor — the backend server's own network was found to drop out
// intermittently) makes a video occasionally fail to load on the first
// try even though the file itself is fine, the same way it eventually
// loaded in a browser after a long wait. Rather than showing "Video failed
// to load" the instant that happens, retry a few times with backoff first
// — most of the time this recovers silently, same as re-opening the page
// would have.
const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 25000];

const Mp4LessonPlayer = forwardRef<LessonVideoPlayerHandle, Props>(function Mp4LessonPlayer(
  { url, onProgress, onDurationKnown, pauseAtSeconds, onReachBoundary },
  ref,
) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Guards against re-firing onReachBoundary on every timeUpdate tick while
  // paused at (or scrubbed back across) the same boundary — reset whenever
  // the caller hands us a new pauseAtSeconds to watch for.
  const boundaryFiredRef = useRef(false);
  const durationReportedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks expo-video's own native fullscreen presentation (entered via the
  // expand button inside `nativeControls`) — that surface renders in its
  // own native layer ABOVE the whole React Native tree, so the segment quiz
  // overlay app/lessons/[id].tsx renders as a normal RN sibling stays
  // hidden behind it. See the boundary-hit branch in the timeUpdate
  // listener below, which drops out of fullscreen the moment a question is
  // due instead of leaving it invisible until the viewer manually shrinks
  // the video back down.
  const videoViewRef = useRef<React.ElementRef<typeof VideoView>>(null);
  const isFullscreenRef = useRef(false);

  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    // `timeUpdate` isn't emitted at all unless this is set — a tight 1s
    // interval keeps the auto-pause snap close to the real boundary instead
    // of overshooting by a couple of seconds.
    p.timeUpdateEventInterval = 1;
  });

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (seconds: number) => {
        player.currentTime = seconds;
        // Seeking back to before the current boundary (e.g. "rewatch this
        // part" after failing its quiz) needs to re-arm it — the
        // pauseAtSeconds *value* isn't changing in that case, so the effect
        // below (keyed on it) won't do this on its own.
        if (pauseAtSeconds != null && seconds < pauseAtSeconds) {
          boundaryFiredRef.current = false;
        }
      },
      play: () => player.play(),
      pause: () => player.pause(),
    }),
    [player, pauseAtSeconds],
  );

  useEffect(() => {
    boundaryFiredRef.current = false;
  }, [pauseAtSeconds]);

  useEffect(() => {
    const statusSubscription = player.addListener('statusChange', (event) => {
      // eslint-disable-next-line no-console
      console.log('Video player status:', event.status, event.error, 'url:', url);

      if (event.status === 'error') {
        if (retryCountRef.current < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[retryCountRef.current];
          retryCountRef.current += 1;
          // eslint-disable-next-line no-console
          console.log(`Video player: retrying in ${delay}ms (attempt ${retryCountRef.current}/${RETRY_DELAYS_MS.length})`);
          // Keep showing the loading spinner rather than the scary error
          // text while a retry is still pending.
          setStatus('loading');
          setErrorMessage(null);
          retryTimeoutRef.current = setTimeout(() => {
            try {
              player.replace(url);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.log('Video player: retry failed to start', e);
            }
          }, delay);
          return;
        }
        // Retries exhausted — this is now a real failure worth surfacing.
        setStatus(event.status);
        setErrorMessage(event.error?.message ?? null);
        return;
      }

      if (event.status === 'readyToPlay') {
        // A real recovery (or a normal first load) — reset the counter so
        // a later, unrelated hiccup gets its own fresh set of retries.
        retryCountRef.current = 0;
      }
      setStatus(event.status);
      setErrorMessage(event.error?.message ?? null);
    });

    const timeSubscription = player.addListener('timeUpdate', () => {
      if (player.duration > 0) {
        if (!durationReportedRef.current) {
          durationReportedRef.current = true;
          onDurationKnown?.(player.duration);
        }
        const percent = Math.min(100, Math.round((player.currentTime / player.duration) * 100));
        onProgress?.(percent);
      }

      if (pauseAtSeconds != null && !boundaryFiredRef.current && player.currentTime >= pauseAtSeconds) {
        boundaryFiredRef.current = true;
        player.currentTime = pauseAtSeconds;
        player.pause();
        if (isFullscreenRef.current) {
          try {
            videoViewRef.current?.exitFullscreen();
          } catch {
            // Best-effort — worst case the viewer still has the manual
            // shrink button as a fallback.
          }
        }
        onReachBoundary?.();
      }
    });

    // Belt-and-suspenders: guarantees we report 100 even if the last
    // timeUpdate tick landed a point or two short of the true end.
    const endSubscription = player.addListener('playToEnd', () => {
      onProgress?.(100);
    });

    return () => {
      statusSubscription.remove();
      timeSubscription.remove();
      endSubscription.remove();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [player, url, onProgress, onDurationKnown, pauseAtSeconds, onReachBoundary]);

  return (
    <View>
      <VideoView
        ref={videoViewRef}
        style={styles.video}
        player={player}
        allowsPictureInPicture
        nativeControls
        onFullscreenEnter={() => {
          isFullscreenRef.current = true;
        }}
        onFullscreenExit={() => {
          isFullscreenRef.current = false;
        }}
      />
      {status === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {status === 'error' ? (
        <Text style={styles.error}>
          Video failed to load after several attempts{errorMessage ? `: ${errorMessage}` : '.'} Check your
          connection and try reopening this lecture.
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  video: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#000',
    marginBottom: 4,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.danger, marginBottom: 16 },
});
