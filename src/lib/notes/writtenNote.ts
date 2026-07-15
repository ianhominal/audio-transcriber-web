/**
 * Utilidades PURAS para "Escribir nota": una nota que la usuaria TECLEA en vez de grabar. Mismo
 * modelo que `chatNote.ts` (transcripción TEXT-ONLY, sin audio, en la misma tabla `transcriptions`
 * y sin ninguna migración nueva) — la inserción real vive en `src/app/api/notes/route.ts`.
 *
 * Diferencia con `buildChatNoteDraft`: acá el título lo puede poner la usuaria (es su nota, no la
 * salida de un modelo), y NO se agrega ningún tag automático — un tag tipo "chat" tiene sentido
 * para distinguir lo que generó la IA, pero ensuciaría una nota escrita a mano.
 */

/** `audio_name` es NOT NULL sin default en el esquema base — esta nota no tiene ningún archivo
 * detrás, así que va una etiqueta fija (mismo criterio que `CHAT_NOTE_AUDIO_NAME`). Solo se usa
 * como fallback de display (`título || audio_name`), nunca como path real. */
export const WRITTEN_NOTE_AUDIO_NAME = "Nota escrita";

/** Ícono fijo para distinguirla de un vistazo de una transcripción con audio en la lista (la
 * columna `icon` guarda emojis elegibles por la usuaria — es contenido, no chrome). */
export const WRITTEN_NOTE_ICON = "📝";

/** Mismo cap y criterio que `MAX_CHAT_NOTE_TEXT_CHARS`: la nota entra a la misma tabla cuyo
 * `search_vector` es una columna GENERATED con índice GIN, y texto sin límite degrada el índice.
 * TRUNCA (no rechaza): perder lo que alguien acaba de escribir sería mucho peor que recortarlo. */
export const MAX_WRITTEN_NOTE_TEXT_CHARS = 40_000;

/** Mismo largo que un título de transcripción normal (`title.trim().slice(0, 120)` en
 * `actions.ts`/`transcribe/route.ts`). */
const TITLE_MAX_LENGTH = 120;

/** Título si la usuaria no puso ninguno y el texto no da para derivar nada. */
const FALLBACK_TITLE = "Nota";

/**
 * Deriva un título de la primera línea con contenido cuando la usuaria no escribió uno.
 * Nunca lanza — cualquier entrada rara cae al fallback.
 */
export function deriveWrittenNoteTitle(text: string): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return FALLBACK_TITLE;

  const firstLine = trimmed.split("\n").find((line) => line.trim().length > 0) ?? "";
  const clean = firstLine.trim();
  if (!clean) return FALLBACK_TITLE;

  return clean.length > TITLE_MAX_LENGTH ? `${clean.slice(0, TITLE_MAX_LENGTH).trim()}…` : clean;
}

export type WrittenNoteDraft = {
  title: string;
  text: string;
  audio_name: string;
  icon: string;
  tags: string[];
};

export type WrittenNoteDraftResult = WrittenNoteDraft | { error: string };

/**
 * Arma los campos de la nota escrita. Pura — no valida sesión/ownership (eso es del route handler
 * vía `getApiUser`), solo la forma del contenido.
 */
export function buildWrittenNoteDraft(rawText: string, rawTitle?: string | null): WrittenNoteDraftResult {
  const text = (rawText ?? "").trim();
  if (!text) return { error: "Escribí algo antes de guardar la nota." };

  const truncatedText =
    text.length > MAX_WRITTEN_NOTE_TEXT_CHARS ? text.slice(0, MAX_WRITTEN_NOTE_TEXT_CHARS) : text;

  const typedTitle = (rawTitle ?? "").trim();
  const title = typedTitle ? typedTitle.slice(0, TITLE_MAX_LENGTH) : deriveWrittenNoteTitle(text);

  return {
    title,
    text: truncatedText,
    audio_name: WRITTEN_NOTE_AUDIO_NAME,
    icon: WRITTEN_NOTE_ICON,
    tags: [],
  };
}
