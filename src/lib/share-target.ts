/**
 * Field name for the shared audio file in the PWA `share_target` (see `src/app/manifest.ts`) —
 * MUST match `share_target.params.files[0].name` exactly, or a share silently stops reaching
 * `/api/share-target` (the browser just won't attach the file under a name nobody reads). Single
 * source of truth so a future rename on either side can't drift apart unnoticed — review
 * adversarial hallazgo NIT.
 */
export const SHARE_TARGET_FILE_FIELD = "file";

/**
 * Max audio files processed per share — bounds `/api/share-target`'s worst-case runtime. Each file
 * makes a full trip through `/api/transcribe` (Groq transcription + best-effort title/tags/
 * translation/vocabulary steps, see `transcribe/route.ts`), all inside ONE invocation capped at
 * `maxDuration = 60` — a single call can already approach that budget, so accepting an unbounded
 * multi-file share (Android lets you multi-select files to share) risked Vercel killing the
 * function mid-loop, silently losing the response for files that already saved fine — review
 * adversarial hallazgo MEDIUM.
 */
export const SHARE_TARGET_MAX_FILES = 3;
