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

/** Vercel's request payload limit (~4.5 MB) — larger recordings are routed to the desktop app instead. */
export const WEB_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
