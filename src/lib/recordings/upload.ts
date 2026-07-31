/**
 * Reading `/api/transcribe` responses without ever trusting them to be JSON.
 *
 * Vercel rejects oversized payloads at the edge with PLAIN TEXT ("Request Entity Too Large"), so
 * `await resp.json()` threw and the UI showed a parser error instead of the real cause — plus a
 * "Reintentar" button that could never work. Always read `.text()`, then interpret here.
 */

import { classifyUploadFailure } from "./policy";
import { describeFetchFailure } from "./fetch-failure";

export type UploadSuccess = {
  ok: true;
  /** Id of the created transcription, or null when the server did not return one. */
  transcriptionId: string | null;
  /** Set when the server transcribed with a different quality than requested (daily quota). */
  qualityWarning: string | null;
  /** False when the text was saved but the audio failed to reach Storage. */
  audioStored: boolean;
  duplicate: boolean;
  /** AI-generated title, when the server produced one (best-effort step, often absent). */
  title: string | null;
  /** AI-generated topic tags, empty when the step did not run. */
  tags: string[];
  /** True when translation was requested and failed — the original transcription was still saved. */
  translationWarning: boolean;
};

export type UploadFailure = {
  ok: false;
  status: "too_large" | "failed";
  /** User-facing reason, already in plain language. */
  message: string;
  /**
   * Id of the note the server rescued (audio saved, transcription failed). When present, retrying
   * would create a duplicate — the caller must offer "ver la nota" instead.
   */
  rescuedId: string | null;
};

export type UploadOutcome = UploadSuccess | UploadFailure;

function parseJson(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * @param httpStatus response status, or null when the request never got an answer.
 * @param rawBody    response body read as TEXT.
 */
export function interpretUploadResponse(httpStatus: number | null, rawBody: string): UploadOutcome {
  const body = parseJson(rawBody);
  const isOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;

  if (isOk) {
    // A 2xx with an unreadable body is still a failure for us: we cannot tell whether the note
    // exists, and claiming success would let the local copy be deleted with nothing to show.
    if (!body) return { ok: false, status: "failed", message: UNREADABLE_OK_MESSAGE, rescuedId: null };
    return {
      ok: true,
      transcriptionId: readString(body, "id"),
      qualityWarning: readString(body, "qualityWarning"),
      audioStored: body.audioStored !== false,
      duplicate: body.duplicate === true,
      title: readString(body, "title"),
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      translationWarning: Boolean(body.translationWarning),
    };
  }

  const failure = classifyUploadFailure(httpStatus, rawBody);
  return { ok: false, ...failure, rescuedId: readString(body, "id") };
}

const UNREADABLE_OK_MESSAGE =
  "El servidor respondió algo que no pudimos leer. La grabación quedó guardada en este dispositivo: " +
  "revisá tus notas y, si no aparece, reintentá.";

/** POSTs a recording and interprets the answer. Never throws on a network drop — returns a failure. */
export async function postRecording(form: FormData): Promise<UploadOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/transcribe", { method: "POST", body: form });
  } catch (err) {
    // The exception is NOT discarded: `fetch` rejecting can mean a dead network OR a file handle
    // the phone already invalidated, and the two need opposite advice. Throwing it away is what
    // left us blind when 14 uploads failed in a row without a single request reaching the server.
    const failure = describeFetchFailure(err);
    return { ok: false, status: "failed", message: failure.message, rescuedId: null };
  }
  // `.text()` can itself fail on a connection cut mid-body; treat that as a network failure too.
  const rawBody = await response.text().catch(() => "");
  return interpretUploadResponse(response.status, rawBody);
}
