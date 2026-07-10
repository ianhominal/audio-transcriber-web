/**
 * Forma estructurada de un resumen generado por IA (Fase F5, ver ROADMAP.md): un resumen breve +
 * puntos clave + tareas/próximos pasos si el texto los menciona explícitamente. Se persiste como
 * JSON serializado en `transcriptions.summary` (columna `text`, ver migración
 * `20260709220000_transcription_summary.sql`) — un único campo en vez de tres columnas separadas
 * porque siempre se lee/escribe como una unidad (nunca se filtra ni se ordena por `keyPoints` o
 * `actionItems` en una query), mismo criterio de simpleza que ya usó F2/F4 para no crear una tabla
 * aparte cuando una columna alcanza.
 */
export type SummaryResult = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
};

/** Máximo de bullets que se aceptan por lista — corta cualquier respuesta del LLM que se vaya de
 * tema y empiece a listar de más (defensa barata, no cambia el costo de la llamada). */
const MAX_LIST_ITEMS = 12;
/** Tope de caracteres por bullet y del párrafo de resumen. Defensa ante un LLM que se desmadre y
 * devuelva un item gigante (o un bloque de texto entero como "bullet"): acota lo que se PERSISTE en
 * `transcriptions.summary` y lo que se pinta, sin depender de que el prompt se respete al pie de la
 * letra. Valores holgados (no recortan un resumen/bullet normal), solo cortan casos patológicos. */
const MAX_ITEM_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 2000;

/** Recorta un string a `max` caracteres (sin dejar espacio colgando al final). */
function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_LIST_ITEMS)
    .map((item) => clamp(item, MAX_ITEM_LENGTH));
}

/**
 * Valida y normaliza un objeto crudo (ya parseado de JSON) a la forma `SummaryResult`. `null` si
 * no tiene la forma mínima esperada (falta `summary` como string no vacío) — el caller decide qué
 * hacer ante eso (ver `parseModelSummaryResponse`/`parseStoredSummary` más abajo), nunca lanza.
 */
function coerceSummaryShape(value: unknown): SummaryResult | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) return null;

  return {
    summary: clamp(summary, MAX_SUMMARY_LENGTH),
    keyPoints: sanitizeStringList(obj.keyPoints),
    actionItems: sanitizeStringList(obj.actionItems),
  };
}

/**
 * El LLM a veces envuelve el JSON en un bloque de código Markdown (```json ... ```) pese a que el
 * prompt pide "solo JSON" — mismo tipo de desvío que `translateText` ya tolera con prefijos tipo
 * "Traducción:" (ver comentario en `src/lib/translate/groq.ts`). Se pela el fence si está antes de
 * intentar parsear.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parsea la respuesta cruda del LLM (contenido del mensaje del chat completion) a `SummaryResult`.
 * `null` ante CUALQUIER problema (no-JSON, forma inesperada, `summary` vacío) — nunca lanza; el
 * caller (`summarizeText`) lo traduce a un `{ ok: false }` best-effort, mismo criterio que
 * `translateText`.
 */
export function parseModelSummaryResponse(raw: string): SummaryResult | null {
  try {
    return coerceSummaryShape(JSON.parse(stripCodeFence(raw)));
  } catch {
    return null;
  }
}

/** Serializa un `SummaryResult` para guardarlo en `transcriptions.summary`. */
export function serializeSummary(summary: SummaryResult): string {
  return JSON.stringify(summary);
}

/**
 * Parsea lo que hay guardado en `transcriptions.summary`. A diferencia de
 * `parseModelSummaryResponse`, acá el string SIEMPRE es el resultado de `serializeSummary` (nunca
 * tiene fences ni prosa alrededor) — pero se valida la forma igual por las dudas (una fila vieja,
 * un edit manual en la DB, etc.). `null` si no hay nada guardado o el JSON es inválido/con forma
 * inesperada.
 */
export function parseStoredSummary(raw: string | null | undefined): SummaryResult | null {
  if (!raw) return null;
  try {
    return coerceSummaryShape(JSON.parse(raw));
  } catch {
    return null;
  }
}
