/**
 * Validación/gating PURA para el paso de auto-título + auto-tags (tanda 3 de quick wins, ver
 * ROADMAP.md). Sin dependencias server-only — se usa desde `/api/transcribe` (server), testeable sin
 * mockear nada, mismo criterio que `canSummarizeText`/`isValidChatMessageText`.
 */

/**
 * Largo mínimo de texto para que tenga sentido pedirle título+tags a un LLM. Mucho más bajo que
 * `MIN_SUMMARY_TEXT_LENGTH` (80, `src/lib/summary/validate.ts`) a propósito: un resumen de un texto
 * corto no tiene contenido que resumir, pero una nota CORTA es exactamente el caso que este feature
 * quiere resolver (una nota de una sola frase también merece un título propio en vez de "Grabación
 * 47"). El piso acá solo existe para no gastar cuota de Groq en texto prácticamente vacío
 * (silencio/ruido transcripto como 1-2 palabras sueltas).
 */
export const MIN_TITLE_TAGS_TEXT_LENGTH = 12;

/** true si `text` alcanza el mínimo para generar título+tags. */
export function canGenerateTitleTags(text: string): boolean {
  return text.trim().length >= MIN_TITLE_TAGS_TEXT_LENGTH;
}

/**
 * true si `title` es un título "mecánico" (derivado automáticamente del nombre de archivo o de una
 * grabación) en vez de uno que la usuaria escribió a mano.
 *
 * Por qué hace falta esto y no alcanza con "¿título vacío?": la cola de `TranscribeWorkspace`
 * (`src/app/app/transcribe/transcribe-workspace.tsx`) SIEMPRE arranca cada ítem con un título por
 * defecto NO VACÍO — el nombre del archivo subido (`file.name`, ver `addFiles`) o
 * `defaultTitleFromFileName(file.name)` para grabaciones/capturas (da algo como
 * "Grabacion-1720368000000", ver `formatRecordingFileName` en `src/lib/format.ts`), editable inline
 * ANTES de transcribir. Si tratáramos "no vacío" como "la usuaria lo puso", el auto-título nunca
 * pisaría nada en la práctica — justo el problema que este feature existe para resolver ("Grabación
 * 47" es conceptualmente lo mismo que "Grabacion-1720368000000": un nombre mecánico, no descriptivo).
 *
 * Heurística (sin cambiar el contrato cliente↔server, sin agregar un flag "¿la usuaria lo editó?"):
 * un título es mecánico si coincide EXACTO con el nombre de archivo (con o sin extensión) o con el
 * patrón "Grabacion-<timestamp>"/"Reunion-<timestamp>". Es deliberadamente conservadora — el
 * auto-título SOLO puede pisar un título reconocido como mecánico, nunca "podría ser mecánico"; ante
 * la duda (un título real que por pura coincidencia calzara con el patrón) se prefiere NO pisarlo.
 */
export function isPlaceholderTitle(title: string, audioName: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;

  const bareAudioName = (audioName ?? "").replace(/\.[^./\\]+$/, "");
  if (trimmed === audioName || trimmed === bareAudioName) return true;

  return /^(Grabacion|Reunion)-\d+$/.test(trimmed);
}
