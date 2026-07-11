import { sanitizeTags } from "@/lib/tags";

/**
 * Resultado estructurado de la generación de título+tags (tanda 3 de quick wins, ver ROADMAP.md):
 * UNA sola llamada al LLM que devuelve un título corto + tags de tema a partir del texto de la
 * transcripción — mata el problema de notas indistinguibles ("Grabación 47"). Ver
 * `src/app/api/transcribe/route.ts` (paso 2.7) para el contrato best-effort completo.
 */
export type TitleTagsResult = {
  title: string;
  tags: string[];
};

/**
 * Tope de caracteres del título — mismo cap que ya usa `updateTranscriptionTitle`/el insert de
 * `/api/transcribe` (`title.trim().slice(0, 120)`), defensa en profundidad ante un modelo que ignore
 * el prompt ("5 a 8 palabras") y devuelva un párrafo entero.
 */
const MAX_TITLE_LENGTH = 120;

function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

/**
 * Valida y normaliza un objeto crudo (ya parseado de JSON) a la forma `TitleTagsResult`. `null` si
 * no tiene la forma mínima esperada (falta `title` como string no vacío) — mismo criterio que
 * `coerceSummaryShape` en `src/lib/summary/format.ts`: el caller decide qué hacer, nunca lanza.
 * `tags` es best-effort: se sanea con `sanitizeTags` (dedupe + minúscula + cap) SIN exigir un
 * mínimo — un título válido con 1 o 2 tags (o ninguno) sigue siendo mejor que nada.
 */
function coerceTitleTagsShape(value: unknown): TitleTagsResult | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;

  return {
    title: clamp(title, MAX_TITLE_LENGTH),
    tags: sanitizeTags(obj.tags),
  };
}

/**
 * El LLM a veces envuelve el JSON en un bloque de código Markdown (```json ... ```) pese a que el
 * prompt pide "solo JSON" — mismo desvío tolerado que `stripCodeFence` en `src/lib/summary/format.ts`.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parsea la respuesta cruda del LLM (contenido del mensaje del chat completion) a `TitleTagsResult`.
 * `null` ante CUALQUIER problema (no-JSON, forma inesperada, `title` vacío) — nunca lanza; el caller
 * (`generateTitleAndTags`) lo traduce a un `{ ok: false }` best-effort, mismo criterio que
 * `parseModelSummaryResponse`.
 */
export function parseModelTitleTagsResponse(raw: string): TitleTagsResult | null {
  try {
    return coerceTitleTagsShape(JSON.parse(stripCodeFence(raw)));
  } catch {
    return null;
  }
}
