/**
 * Glue between a stored recording and `/api/transcribe`. The two pure pieces here (form building
 * and the post-upload metadata patch) are covered by Vitest; the orchestration below just calls
 * them plus `db.ts`.
 */

import type { LocalRecording, LocalRecordingMeta } from "./types";
import { getRecording, getRecordingMeta, updateRecording } from "./db";
import { postRecording, type UploadOutcome } from "./upload";

/** Fields `/api/transcribe` expects alongside the audio. Mirrors both capture surfaces. */
export type TranscribeFields = {
  language: string;
  model: string;
  mode: string;
  title: string;
  projectId?: string;
  targetLanguage?: string;
  useVocabulary?: boolean;
};

export function buildTranscribeForm(file: File, fields: TranscribeFields): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("language", fields.language);
  form.append("model", fields.model);
  form.append("mode", fields.mode);
  form.append("title", fields.title);
  if (fields.projectId) form.append("projectId", fields.projectId);
  if (fields.targetLanguage) form.append("targetLanguage", fields.targetLanguage);
  if (fields.useVocabulary !== undefined) form.append("useVocabulary", String(fields.useVocabulary));
  return form;
}

/**
 * How a recording's metadata changes after an upload attempt.
 *
 * A rescued note counts as `uploaded` on purpose: the server already has the audio and created the
 * note, so retrying would produce a SECOND note for the same recording.
 */
export function nextMetaAfterUpload(
  outcome: UploadOutcome,
  attempts: number
): Partial<Omit<LocalRecordingMeta, "id">> {
  if (outcome.ok) {
    return {
      status: "uploaded",
      transcriptionId: outcome.transcriptionId ?? undefined,
      lastError: undefined,
      attempts: attempts + 1,
    };
  }
  if (outcome.rescuedId) {
    return { status: "uploaded", transcriptionId: outcome.rescuedId, lastError: outcome.message, attempts: attempts + 1 };
  }
  return { status: outcome.status, lastError: outcome.message, attempts: attempts + 1 };
}

/**
 * Writes the result of an upload the CALLER performed (the transcription queue posts its own
 * FormData with per-batch project/language settings) into the library. Silently does nothing when
 * the recording is not tracked locally — uploaded files are never stored.
 */
export async function recordUploadOutcome(id: string | undefined, outcome: UploadOutcome): Promise<void> {
  if (!id) return;
  const current = await getRecordingMeta(id);
  if (!current) return;
  await updateRecording(id, nextMetaAfterUpload(outcome, current.attempts));
}

/** Rebuilds a `File` from stored bytes so a retry sends exactly what was recorded. */
export function toFile(recording: LocalRecording): File {
  return new File([recording.blob], recording.fileName, { type: recording.mimeType });
}

/**
 * Uploads a stored recording and records the outcome in the library. The local copy is NEVER
 * deleted here — even on success it stays as the user's on-device library (quota trimming, which
 * only ever touches already-uploaded audio, is `enforceQuota`'s job).
 */
export async function uploadStoredRecording(id: string, fields: TranscribeFields): Promise<UploadOutcome> {
  const recording = await getRecording(id);
  if (!recording) {
    return { ok: false, status: "failed", message: "Esa grabación ya no está en este dispositivo.", rescuedId: null };
  }
  const outcome = await postRecording(buildTranscribeForm(toFile(recording), fields));
  await updateRecording(id, nextMetaAfterUpload(outcome, recording.attempts));
  return outcome;
}
