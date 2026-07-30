/**
 * Shared MediaRecorder helpers for both recording surfaces (`TranscribeWorkspace`'s inline
 * "Grabar" button and `/app/capturar`'s one-tap capture flow) — extracted so browser-compat
 * mimeType logic lives in exactly one place instead of drifting between two copies.
 */

/** MediaRecorder mimeType candidates, in preference order (browser support varies). */
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

/** Picks the first mimeType this browser's MediaRecorder supports (or undefined if none/unsupported). */
export function pickSupportedMimeType(candidates: string[] = AUDIO_MIME_CANDIDATES): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/** File extension matching a recorded mimeType (webm or ogg — the only two MediaRecorder can produce here). */
export function extensionForMimeType(mimeType: string): string {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

/**
 * Largest audio we dare POST to `/api/transcribe`. Larger recordings are kept on-device and routed
 * to the desktop app instead (see `src/lib/recordings/`).
 *
 * Vercel's request body ceiling is 4.5 MB DECIMAL (4_500_000), not 4.5 MiB. This used to be
 * `4.5 * 1024 * 1024` = 4_718_592, so a recording in that ~218 KB gap passed our own check and was
 * then rejected by the platform edge in plain text ("Request Entity Too Large") — the request never
 * reached the handler, so the server-side audio rescue never ran either. On top of that, the
 * multipart envelope (boundaries, per-field headers, the filename) adds its own bytes on the wire,
 * so the ceiling has to sit BELOW the platform limit, not exactly on it.
 */
export const WEB_MAX_BYTES = 4_400_000;
