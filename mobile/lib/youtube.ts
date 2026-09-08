/**
 * Recognizes a pasted YouTube link in any of its common shapes and pulls out
 * the 11-character video ID, which is all react-native-youtube-iframe (see
 * components/YoutubeLessonPlayer.tsx) actually needs to embed the player.
 *
 * Returns null for anything that isn't a YouTube link — including a plain
 * uploaded-file URL (/media/videos/...) or some other external video link —
 * so callers can fall back to the regular direct-file player for those.
 */
const YOUTUBE_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/,
];

export function extractYoutubeId(url: string): string | null {
  for (const pattern of YOUTUBE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
