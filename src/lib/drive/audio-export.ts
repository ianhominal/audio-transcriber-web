/**
 * Sending an audio created in the app UP to its connected Drive folder.
 *
 * Closes the loop that importing left half open: `planDriveImport` already brings recordings DOWN
 * from Drive, but an audio uploaded or recorded inside the app never travelled back, so a connected
 * folder slowly filled with notes and no recordings. The requirement from the owner is explicit: a
 * connected Drive folder syncs BOTH ways, audios and transcripts.
 *
 * Pure decisions only; the upload itself lives in `./audio-export.server.ts`.
 */

/**
 * Extensions the app accepts (see `@/lib/transcribe/accept`) mapped to the MIME type Drive should
 * record. Drive uses it for previews and for deciding whether its own player can open the file.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".mpga": "audio/mpeg",
  ".mpeg": "video/mpeg",
  ".mp4": "video/mp4",
};

/**
 * MIME type for a file name. Falls back to `application/octet-stream` rather than guessing: Drive
 * takes the upload either way, and an honest generic type beats a wrong specific one.
 */
export function driveMimeTypeForAudio(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_BY_EXTENSION[lower.slice(dot)] ?? "application/octet-stream";
}

/**
 * Whether this transcription's audio should be pushed to Drive.
 *
 * The `driveAudioFileId` check is what stops an import/export loop: a recording that CAME from Drive
 * already carries its file id, and sending it back would drop a duplicate next to the original on
 * every single run.
 */
export function shouldExportAudioToDrive({
  driveFolderId,
  driveAudioFileId,
  storagePath,
}: {
  /** Drive folder the project maps to, or `null` when the project is not under a connected folder. */
  driveFolderId: string | null;
  /** Set when the audio already exists in Drive (imported from there, or exported before). */
  driveAudioFileId: string | null;
  /** Object path in Supabase Storage; `null`/empty for a text-only note. */
  storagePath: string | null;
}): boolean {
  if (!driveFolderId) return false;
  if (driveAudioFileId) return false;
  if (!storagePath) return false;
  return true;
}
