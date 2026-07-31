/**
 * Whether a stored file should be played with `<audio>` or `<video>`.
 *
 * Transcribing video is deliberate: `/api/transcribe` accepts mp4/mpeg/webm because Whisper pulls
 * the audio track out of them (see `src/lib/transcribe/accept.ts`). Playback was the part that
 * lagged behind — the detail page always used `<audio>`, and an `<audio>` element handed a video
 * container behaves inconsistently across browsers: sometimes it plays the audio track, sometimes
 * it loads nothing. A tester got the second case.
 *
 * `<video>` plays audio-only files perfectly well, so when in doubt it is the safer element.
 */

export type MediaKind = "audio" | "video";

/** Containers that must go through `<video>`. `.webm` is here because it can carry a picture. */
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "mkv", "webm", "avi", "mpeg", "mpg", "ogv"]);

function extensionOf(fileName: string): string {
  // Signed URLs arrive with a query string; the hash never carries the extension either.
  const withoutQuery = fileName.split(/[?#]/)[0];
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  return dot === -1 ? "" : lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * @param fileName file name or URL (a signed URL's query string is ignored).
 * @param mimeType optional, wins over the extension when present — it is the stronger signal.
 */
export function resolveMediaKind(fileName: string | null | undefined, mimeType?: string | null): MediaKind {
  if (mimeType) {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
  }

  if (!fileName) return "audio";
  return VIDEO_EXTENSIONS.has(extensionOf(fileName)) ? "video" : "audio";
}
