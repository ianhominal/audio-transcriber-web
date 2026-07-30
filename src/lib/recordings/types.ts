/**
 * On-device recording library (see `db.ts` for the IndexedDB layer).
 *
 * Why this exists: until now a recording lived in exactly ONE place between "Detener" and the
 * server acking the upload — the tab's RAM. A 413, a dropped connection or Android reclaiming the
 * backgrounded tab destroyed it, and a recording cannot be re-made. Every capture surface now
 * writes here in `onstop`, BEFORE attempting any upload.
 */

/** Where the audio came from. Uploaded files are never stored — the user already has those on disk. */
export type LocalRecordingSource = "mic" | "meeting";

/**
 * - `pending`  — captured, not yet accepted by the server. Irreplaceable: never auto-purged.
 * - `uploaded` — the server has it. Kept for the local library, and the ONLY status eligible for
 *                quota purging (a purge here loses nothing, the audio lives in Storage).
 * - `too_large` — over the web upload ceiling. Retrying is pointless; the user downloads it and
 *                 uses the desktop app. Irreplaceable: never auto-purged.
 * - `failed`   — upload attempted and rejected for a reason that may not repeat. Irreplaceable.
 */
export type LocalRecordingStatus = "pending" | "uploaded" | "too_large" | "failed";

/** Everything about a stored recording except the audio itself — cheap to list without loading blobs. */
export type LocalRecordingMeta = {
  id: string;
  /** Download filename, e.g. `Grabacion-1720368000000.webm`. */
  fileName: string;
  /** Human-facing title, mirrors what the transcription queue shows. */
  title: string;
  mimeType: string;
  sizeBytes: number;
  /** Wall-clock length in seconds, as counted by the recording timer (0 when unknown). */
  durationSec: number;
  createdAt: number;
  source: LocalRecordingSource;
  status: LocalRecordingStatus;
  /** Upload attempts so far — surfaced in the UI so a stuck recording is visible, not silent. */
  attempts: number;
  /** Last failure reason, already user-facing (Spanish). Absent when the last attempt succeeded. */
  lastError?: string;
  /** Set once the server accepted it, so the UI can link straight to the note. */
  transcriptionId?: string;
};

/** A stored recording plus its audio. Only loaded on demand (download / retry). */
export type LocalRecording = LocalRecordingMeta & { blob: Blob };
