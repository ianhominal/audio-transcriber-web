/**
 * Utilidades PURAS para "Guardar como nota" en el chat (quick win del brainstorm, ver
 * ROADMAP.md/BRAINSTORM.md — "Sacar el output afuera"): convierte el contenido de una respuesta
 * del asistente en el draft de una transcripción TEXT-ONLY nueva (sin audio). La inserción real en
 * Supabase vive en el route handler (`src/app/api/notes/route.ts`) — este módulo no llama a
 * Supabase, solo arma los campos.
 */

/** Tag distintivo para marcar una nota creada desde el chat — reusa el modelo de tags existente
 * (`transcriptions.tags`, ver `src/lib/tags.ts`) en vez de sumar una columna nueva: cero migración,
 * y ya se ve como chip clickeable/filtrable en la lista y el detalle. */
export const CHAT_NOTE_TAG = "chat";

/** `audio_name` es NOT NULL sin default en el esquema (`supabase/migrations/20260706154044_init_schema.sql`)
 * — esta nota no corresponde a ningún archivo real, así que se usa una etiqueta fija en vez de un
 * nombre de archivo inventado. Solo se usa como fallback de display (`título || audio_name`) en el
 * resto de la app, nunca se interpreta como un path real. */
export const CHAT_NOTE_AUDIO_NAME = "Nota del chat";

/** Ícono fijo (columna `icon`, `20260706200000_transcription_metadata.sql`, NOT NULL DEFAULT ''
 * — segura de setear, la migración es de la primera semana del proyecto) para que una nota de chat
 * se distinga de un vistazo en la lista, además del tag `CHAT_NOTE_TAG`. */
export const CHAT_NOTE_ICON = "💬";

/** Título por defecto si no se puede derivar nada útil del texto. */
const FALLBACK_TITLE = "Nota del chat";

/** Largo máximo del título derivado — igual de corto que un título de transcripción normal
 * (`title.trim().slice(0, 120)` en `actions.ts`/`transcribe/route.ts`), pero más chico (80): una
 * primera línea de chat suele ser más larga que un título escrito a mano. */
const TITLE_MAX_LENGTH = 80;

/**
 * Deriva un título corto a partir de la primera línea con contenido real de una respuesta del
 * chat, pelando el markup Markdown más común (heading, negrita/cursiva/código) para que el título
 * no arrastre `#`/`*`/`` ` `` sueltos. Nunca lanza — cualquier entrada rara cae al fallback.
 */
export function deriveChatNoteTitle(text: string): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return FALLBACK_TITLE;

  const firstLine = trimmed.split("\n").find((line) => line.trim().length > 0) ?? "";
  const clean = firstLine
    .replace(/^#{1,6}\s*/, "") // heading Markdown ("## Título" → "Título")
    .replace(/[*_`]/g, "") // énfasis/código sueltos
    .trim();

  if (!clean) return FALLBACK_TITLE;
  return clean.length > TITLE_MAX_LENGTH ? `${clean.slice(0, TITLE_MAX_LENGTH).trim()}…` : clean;
}

export type ChatNoteDraft = {
  title: string;
  text: string;
  audio_name: string;
  icon: string;
  tags: string[];
};

export type ChatNoteDraftResult = ChatNoteDraft | { error: string };

/**
 * Arma los campos de la nueva transcripción text-only a partir del contenido crudo de una
 * respuesta del chat. Pura — no valida sesión/ownership (eso es responsabilidad del route handler,
 * vía `getApiUser`), solo la forma del contenido.
 */
export function buildChatNoteDraft(rawText: string): ChatNoteDraftResult {
  const text = (rawText ?? "").trim();
  if (!text) return { error: "No hay contenido para guardar." };

  return {
    title: deriveChatNoteTitle(text),
    text,
    audio_name: CHAT_NOTE_AUDIO_NAME,
    icon: CHAT_NOTE_ICON,
    tags: [CHAT_NOTE_TAG],
  };
}
