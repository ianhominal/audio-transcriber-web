/**
 * Largo mínimo de texto para que tenga sentido pedirle un resumen a un LLM (Fase F5, ver
 * ROADMAP.md). Resumir 2 palabras no aporta nada y solo gasta la cuota de Groq — mismo criterio
 * de "no llamar al LLM si no hace falta" que `translateText` ya aplica con texto vacío
 * (`src/lib/translate/groq.ts`), pero acá el piso es más alto porque un resumen de un texto corto
 * literalmente no tiene contenido que resumir.
 *
 * 80 caracteres ~ una o dos oraciones cortas — elegido a ojo (no hay una "cifra correcta"), pensado
 * para bloquear casos obviamente inútiles (un título suelto, "probando 1 2 3") sin ser tan estricto
 * que moleste en transcripciones cortas pero legítimas. Revisable si en el uso real molesta.
 */
export const MIN_SUMMARY_TEXT_LENGTH = 80;

/**
 * true si `text` es lo bastante largo como para resumir. Función PURA sin dependencias (ni
 * `crypto` ni nada server-only) a propósito: se importa tanto del backend (`/api/summarize`) como
 * del componente cliente (`transcription-detail.tsx`, para deshabilitar/avisar en la UI antes de
 * siquiera llamar al endpoint) — mismo criterio de reuso que `resolveTranslationLanguage` en
 * `src/lib/translate/languages.ts`, que también es pura y se usa en ambos lados.
 */
export function canSummarizeText(text: string): boolean {
  return text.trim().length >= MIN_SUMMARY_TEXT_LENGTH;
}
