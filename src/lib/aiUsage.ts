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

/**
 * Tope de mensajes de chat (llamadas reales a Groq) que un usuario puede mandar por día — mismo
 * mecanismo reserve-on-attempt que `SUMMARY_DAILY_LIMIT`, vía un segundo trigger `BEFORE INSERT`
 * independiente sobre `ai_usage_log` (`kind = 'chat'`, ver migración
 * `20260710140000_chat_messages.sql`). A diferencia del resumen, el chat NO tiene un cache que
 * absorba la mayoría de los pedidos (cada mensaje es una pregunta distinta) — el número es más alto
 * que `SUMMARY_DAILY_LIMIT` para no cortar una conversación normal de varias idas y vueltas, pero
 * sigue acotando el costo/abuso sobre la GROQ_API_KEY compartida. DEBE coincidir con el número
 * hardcodeado en el trigger `enforce_ai_usage_chat_limit`.
 */
export const CHAT_DAILY_LIMIT = 60;

/**
 * Tope de generaciones de título+tags (llamadas reales a Groq) por usuario/día — tercer trigger
 * `BEFORE INSERT` independiente sobre `ai_usage_log` (`kind = 'title_tags'`, ver migración
 * `20260711160000_transcription_tags.sql`). A diferencia del resumen (a pedido manual, con un cache
 * que absorbe la mayoría de los pedidos), este paso corre AUTOMÁTICO en cada transcripción (ver
 * `src/lib/titleTags/groq.ts` y el paso 2.7 de `/api/transcribe`) — por eso el número es más
 * generoso que `SUMMARY_DAILY_LIMIT` y se acerca más al orden de magnitud de `DAILY_LIMIT`
 * (transcripciones/día, `src/lib/rateLimit.ts`): pensado para no ser, en la práctica, un límite real
 * del uso normal de una sola cuenta, solo la red de seguridad de costo/abuso. Un rechazo acá NUNCA
 * es un bug — el caller lo trata igual que cualquier otra falla best-effort de este paso: se salta
 * la generación y la transcripción se guarda igual. DEBE coincidir con el número hardcodeado en el
 * trigger `enforce_ai_usage_title_tags_limit`.
 */
export const TITLE_TAGS_DAILY_LIMIT = 100;

/**
 * Tope de aplicaciones de formato (llamadas reales a Groq, `kind: "recipe"`) por usuario/día — cuarto
 * trigger `BEFORE INSERT` independiente sobre `ai_usage_log` (ver migración
 * `20260713120000_ai_recipes.sql`, función `enforce_ai_usage_recipe_limit`). "Aplicar formato" es a
 * pedido MANUAL como el chat (`CHAT_DAILY_LIMIT`), pero con una salida en promedio más larga/costosa
 * (un brief de producción completo, una escaleta) que un mensaje de chat típico — por eso el número
 * queda por debajo de `CHAT_DAILY_LIMIT` y bien por debajo de `TITLE_TAGS_DAILY_LIMIT` (que es
 * automático y de salida corta). DEBE coincidir con el número hardcodeado en el trigger.
 */
export const AI_RECIPE_DAILY_LIMIT = 50;

// Tokens estables que raise-ea el trigger BEFORE INSERT (ver migración). Se detectan por substring
// en el mensaje del error de PostgREST — mismo mecanismo que `isTermLimitError` en
// `src/lib/vocabulary/store.ts`, elegido a propósito para no depender del SQLSTATE (que PostgREST no
// siempre preserva). Nunca se reenvía el mensaje crudo al cliente.
const SUMMARY_DAILY_LIMIT_TOKEN = "ai_summary_daily_limit_reached";
const SUMMARY_FORCE_LIMIT_TOKEN = "ai_summary_force_daily_limit_reached";
const CHAT_DAILY_LIMIT_TOKEN = "ai_chat_daily_limit_reached";
const TITLE_TAGS_DAILY_LIMIT_TOKEN = "ai_title_tags_daily_limit_reached";
const RECIPE_DAILY_LIMIT_TOKEN = "ai_recipe_daily_limit_reached";

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite DIARIO total. */
export function isAiSummaryDailyLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(SUMMARY_DAILY_LIMIT_TOKEN);
}

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite de REGENERACIONES. */
export function isAiSummaryForceLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(SUMMARY_FORCE_LIMIT_TOKEN);
}

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite diario de CHAT. */
export function isAiChatDailyLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(CHAT_DAILY_LIMIT_TOKEN);
}

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite diario de
 * TÍTULO+TAGS (`kind: "title_tags"`, ver paso 2.7 de `/api/transcribe`). */
export function isAiTitleTagsDailyLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(TITLE_TAGS_DAILY_LIMIT_TOKEN);
}

/** true si el error del INSERT en `ai_usage_log` es el rechazo del trigger por límite diario de
 * FORMATOS aplicados (`kind: "recipe"`, ver `/api/recipes/apply`). */
export function isAiRecipeDailyLimitError(error: { message?: unknown } | null | undefined): boolean {
  return !!error && typeof error.message === "string" && error.message.includes(RECIPE_DAILY_LIMIT_TOKEN);
}
