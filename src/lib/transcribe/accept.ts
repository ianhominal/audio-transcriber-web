/**
 * What goes in the `accept` attribute of the audio file input.
 *
 * Extracted from the transcribe workspace because of a real mobile bug: on Android the picker
 * offered ONLY "Camera Camcorder" and "Photos & videos" — no way to browse for an audio file at
 * all. The attribute listed extensions only (".mp3,.wav,..."), and Chrome on Android turns `accept`
 * into MIME types to build the `ACTION_GET_CONTENT` intent: bare extensions resolve to nothing
 * usable, while the video extensions (.mp4/.webm/.mpeg) pushed it towards "video", which is exactly
 * the camera-and-gallery picker the user got.
 *
 * The fix is to declare MIME types AND keep the extensions: mobile resolves the MIME types, desktop
 * browsers keep filtering by extension in their native dialog.
 */

/** Formats Groq/Whisper accepts natively (mp4/mpeg included: it extracts the audio from video). */
export const SUPPORTED_EXTENSIONS = [
  ".mp3", ".wav", ".ogg", ".opus", ".m4a", ".mp4",
  ".mpeg", ".mpga", ".flac", ".webm",
] as const;

/**
 * MIME types, listed FIRST so a mobile picker resolves the broadest intent it can. `audio/*` is the
 * entry that actually fixes Android; the three video containers stay selectable because Whisper
 * pulls the audio track out of them.
 */
const SUPPORTED_MIME_TYPES = [
  "audio/*",
  "video/mp4",
  "video/mpeg",
  "video/webm",
] as const;

/** Ready to drop into `<input type="file" accept={FILE_ACCEPT}>`. */
export const FILE_ACCEPT = [...SUPPORTED_MIME_TYPES, ...SUPPORTED_EXTENSIONS].join(",");
