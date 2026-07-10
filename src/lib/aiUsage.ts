/**
 * Caps de operaciones IA por usuario/24h (auditoría 2026-07-10, hallazgo MEDIUM #3). El enforcement
 * es ATÓMICO a nivel DB: un trigger BEFORE INSERT sobre `ai_usage_log` cuenta y rechaza dentro de la
 * misma transacción del INSERT (ver migración `20260710130000_ai_usage_log.sql`), mismo patrón que
 * `enforce_vocabulary_term_limit`. La app NO hace un count-then-insert (evita la carrera TOCTOU que
 * marcó el review adversarial 2026-07-10, WARNING #3) — solo intenta el INSERT y traduce el error
 * del trigger a un 429 amigable vía los detectores de abajo.
 *
 * Se cuentan filas de `ai_usage_log` — no filas de `transcriptions` — porque una regeneración con
 * `force` reescribe la MISMA fila en vez de crear una nueva, y necesitamos poder contar "cuántas
 * llamadas reales al LLM hizo este usuario hoy".
 *
 * El cache de `/api/summarize` (comparar `summary_source_hash` contra el hash del texto actual)
 * sigue siendo el freno PRIMARIO: la mayoría de los pedidos de resumen nunca llegan a registrar uso
 * porque se sirven desde cache sin llamar a Groq. Estos caps son la red de seguridad para cuando el
 * cache no aplica (primera generación) o se saltea a propósito (`force`).
 */

/**
 * Tope de resúmenes IA (llamadas reales a Groq, sin contar cache) que un usuario puede generar por
 * día — mismo orden de magnitud que `DAILY_LIMIT` de transcripciones (src/lib/rateLimit.ts). DEBE
 * coincidir con el número hardcodeado en el trigger `enforce_ai_usage_summary_limit` (la DB es la
 * fuente de verdad del enforcement; este valor es la referencia/documentación del lado app).
 */
export const SUMMARY_DAILY_LIMIT = 100;

/**
 * Tope, más estricto, de regeneraciones FORZADAS (`force: true`, botón "Regenerar") por día. Es el
 * vector de abuso puntual que motivó este fix: `force` saltea el cache a propósito, así que sin un
 * techo aparte un usuario podría loopear "Regenerar" sobre la MISMA transcripción sin límite. DEBE
 * coincidir con el número hardcodeado en el trigger `enforce_ai_usage_summary_limit`.
 */
export const SUMMARY_FORCE_DAILY_LIMIT = 20;

// Tokens estables que raise-ea el trigger BEFORE INSERT (ver migración). Se detectan por substring
// en el mensaje del error de PostgREST — mismo mecanismo que `isTermLimitError` en
// `src/lib/vocabulary/store.ts`, elegido a propósito para no depender del SQLSTATE (que PostgREST no
// siempre preserva). Nunca se reenvía el mensaje crudo al cliente.
const SUMMARY_DAILY_LIMIT_TOKEN = "ai_summary_daily_limit_reached";
const SUMMARY_FORCE_LIMIT_TOKEN = "ai_summary_force_daily_limit_reached";

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite DIARIO total. */
export function isAiSummaryDailyLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(SUMMARY_DAILY_LIMIT_TOKEN);
}

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite de REGENERACIONES. */
export function isAiSummaryForceLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(SUMMARY_FORCE_LIMIT_TOKEN);
}
