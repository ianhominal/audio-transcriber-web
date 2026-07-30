/**
 * Pure decisions about the on-device recording library — no IndexedDB, no React, no `window`.
 * Lives apart from `db.ts` so Vitest (node env, see vitest.config.mts) can cover the rules that
 * actually protect the user's audio.
 */

import type { LocalRecordingMeta } from "./types";

/**
 * Ceiling for the local library. Only `uploaded` recordings are ever purged to respect it (see
 * `selectPurgeCandidates`), so this caps the "nice to have" copies, never the irreplaceable ones.
 * ~1 GiB is dozens of hours of Opus audio — generous on a phone without being reckless.
 */
export const LOCAL_LIBRARY_QUOTA_BYTES = 1024 * 1024 * 1024;

/**
 * Markers of a payload rejected by the platform edge BEFORE reaching the route handler. Vercel
 * answers these as PLAIN TEXT, which is why parsing the response as JSON blew up with
 * `Unexpected token 'R', "Request En"...` and buried the real cause.
 */
const PAYLOAD_TOO_LARGE_MARKERS = [/request entity too large/i, /payload too large/i, /FUNCTION_PAYLOAD_TOO_LARGE/i];

const OVERSIZE_MESSAGE =
  "Esta grabación no entra por la web. Quedó guardada en este dispositivo: podés descargarla y " +
  "transcribirla con la app de escritorio, que no tiene límite de tamaño.";

const OFFLINE_MESSAGE =
  "No se pudo conectar con el servidor. La grabación quedó guardada en este dispositivo: " +
  "reintentá cuando tengas señal.";

const GENERIC_FAILURE_MESSAGE =
  "No se pudo subir la grabación. Quedó guardada en este dispositivo y podés reintentar cuando quieras.";

/** Reads our own `{ error }` payload, or null when the body is not JSON (platform errors, HTML pages). */
function serverMessage(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON — a platform error or an HTML error page. Never surface the raw body: it is where
    // `Unexpected token 'R'` came from, and it means nothing to the user.
  }
  return null;
}

/**
 * Turns a failed upload into a status the library can act on, plus a message safe to show.
 *
 * @param httpStatus response status, or null when the request never got an answer (network drop).
 * @param rawBody    response body as TEXT — read with `.text()`, never `.json()`.
 */
export function classifyUploadFailure(
  httpStatus: number | null,
  rawBody: string
): { status: "too_large" | "failed"; message: string } {
  const tooLarge = httpStatus === 413 || PAYLOAD_TOO_LARGE_MARKERS.some((marker) => marker.test(rawBody));
  const fromServer = serverMessage(rawBody);
  if (tooLarge) return { status: "too_large", message: fromServer ?? OVERSIZE_MESSAGE };
  if (fromServer) return { status: "failed", message: fromServer };
  return { status: "failed", message: httpStatus === null ? OFFLINE_MESSAGE : GENERIC_FAILURE_MESSAGE };
}

/** True while retrying could plausibly succeed. Oversized and already-uploaded recordings cannot. */
export function canRetry(recording: LocalRecordingMeta): boolean {
  return recording.status === "pending" || recording.status === "failed";
}

/** True when this device holds the ONLY copy of the audio — the server does not have it yet. */
export function isIrreplaceable(recording: LocalRecordingMeta): boolean {
  return recording.status !== "uploaded";
}

/**
 * Ids to delete so the library fits back inside its quota, oldest uploaded first.
 * Irreplaceable recordings are never candidates: freeing space can never cost the user audio.
 */
export function selectPurgeCandidates(
  recordings: LocalRecordingMeta[],
  options: { quotaBytes?: number } = {}
): string[] {
  const quotaBytes = options.quotaBytes ?? LOCAL_LIBRARY_QUOTA_BYTES;
  let used = totalBytes(recordings);
  if (used <= quotaBytes) return [];

  const purgeable = recordings.filter((rec) => !isIrreplaceable(rec)).sort((a, b) => a.createdAt - b.createdAt);
  const ids: string[] = [];
  for (const rec of purgeable) {
    if (used <= quotaBytes) break;
    ids.push(rec.id);
    used -= rec.sizeBytes;
  }
  return ids;
}

/** Newest first — the recording someone is worried about is the one they just made. */
export function sortForDisplay<T extends LocalRecordingMeta>(recordings: T[]): T[] {
  return [...recordings].sort((a, b) => b.createdAt - a.createdAt);
}

export function totalBytes(recordings: LocalRecordingMeta[]): number {
  return recordings.reduce((sum, rec) => sum + rec.sizeBytes, 0);
}

/** One-line status for the library list. Plain language: no status codes, no parser noise. */
export function describeStatus(recording: LocalRecordingMeta): string {
  switch (recording.status) {
    case "uploaded":
      return "Subida y transcrita.";
    case "too_large":
      return "No entra por la web. Descargala y transcribila con la app de escritorio.";
    case "failed":
      return recording.lastError
        ? `No se pudo subir: ${recording.lastError}`
        : "No se pudo subir. Podés reintentar cuando quieras.";
    case "pending":
      return "Guardada en este dispositivo. Todavía no se subió.";
  }
}
