/**
 * Caps y validación del vocabulario custom (feature diferencial #1, ver .claude/resources/BUSINESS.md).
 * Función PURA sin dependencias server-only a propósito: se usa tanto en `/api/vocabulary` (validar
 * antes de escribir) como en la UI (`vocabulary-section.tsx`, para deshabilitar el input antes de
 * pegarle al endpoint) — mismo criterio de reuso que `canSummarizeText`/`resolveTranslationLanguage`.
 */

/** Largo máximo de un término — coincide con el CHECK de la migración (defensa en dos capas). */
export const MAX_TERM_LENGTH = 80;

/**
 * Cantidad máxima de términos por usuario. 100 es generoso para un diccionario personal de nombres/
 * jerga (elegido a ojo, revisable) y acota el costo/tamaño del prompt de corrección — ver
 * `MAX_CORRECTION_INPUT_CHARS` en `groq.ts`.
 */
export const MAX_VOCABULARY_TERMS = 100;

/**
 * Normaliza y valida un término crudo (del body de un request o de un `<input>`). `null` si no es
 * un string, si queda vacío después del trim, o si supera `MAX_TERM_LENGTH` — nunca lanza. El
 * mensaje de error concreto lo arma el caller (mismo criterio que `canSummarizeText`).
 */
export function sanitizeTerm(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_TERM_LENGTH) return null;
  return trimmed;
}

/** true si el usuario todavía puede agregar otro término sin superar el máximo. */
export function canAddVocabularyTerm(currentCount: number): boolean {
  return currentCount < MAX_VOCABULARY_TERMS;
}
