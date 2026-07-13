import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { buildRecipePrompt } from "./validate";

// Mismo modelo que el chat (`CHAT_MODEL`, `src/lib/chat/config.ts`) — no se importa la constante para
// no acoplar `recipes` a `chat` (dos features independientes que hoy comparten proveedor/modelo por
// casualidad, no por diseño): "aplicar un formato" es, como el chat, generación de calidad
// conversacional/redaccional (un brief, una escaleta), no una tarea estructurada corta como el resumen
// (que sí usa el modelo barato `llama-3.1-8b-instant`).
export const RECIPE_MODEL = "llama-3.3-70b-versatile";

/**
 * Arma los args comunes (`model`, `prompt`) que le pasan al AI SDK tanto el endpoint en streaming
 * (`/api/recipes/apply`, vía `streamText`) como el auto-apply best-effort NO streaming
 * (`autoApplyDefaultRecipe`, ver `src/lib/recipes/autoApply.ts`, vía `applyRecipeText` de acá abajo).
 * Único punto de verdad de "qué modelo y qué prompt se usa al aplicar un formato" — evita duplicar esa
 * decisión entre los dos callers (el brief de auto-apply lo pide explícito: "reuse the recipe-
 * application logic ... do not duplicate the prompt-building/model-calling logic").
 */
export function buildRecipeModelCall(instruction: string, transcriptionText: string) {
  return {
    model: groq(RECIPE_MODEL),
    prompt: buildRecipePrompt(instruction, transcriptionText),
  };
}

/**
 * Timeout de la llamada NO streaming (`applyRecipeText`, usada por el auto-apply best-effort, nunca
 * por el endpoint interactivo `/api/recipes/apply` — ese usa `streamText` directo, sin este límite
 * propio, porque ahí la usuaria está mirando la generación en vivo y puede cancelarla ella misma).
 *
 * Más alto que `TITLE_TAGS_TIMEOUT_MS` (8s, `src/lib/titleTags/groq.ts`) a propósito: acá el modelo es
 * el pesado de calidad conversacional (`llama-3.3-70b-versatile`, no el barato `llama-3.1-8b-instant`
 * de título/tags) y la salida esperada es más larga (un brief de producción completo, una escaleta),
 * no un título de una línea. Mismo criterio de fondo que título/tags: un techo propio y corto asegura
 * que, si Groq se cuelga respondiendo, este paso NO se coma el resto del presupuesto de tiempo del
 * request (`maxDuration = 60` en `/api/transcribe`) — se corta solo y la transcripción se guarda igual
 * (regla de oro del auto-apply, ver `src/lib/recipes/autoApply.ts`).
 */
export const DEFAULT_RECIPE_TIMEOUT_MS = 20_000;

export type ApplyRecipeTextResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Aplica `instruction` a `transcriptionText` EN NO-STREAMING (`generateText`, junta la respuesta
 * completa antes de devolverla) — a diferencia del endpoint interactivo (`/api/recipes/apply`, que
 * usa `streamText` porque la usuaria mira la generación en vivo), esta función la usa el auto-apply
 * best-effort al terminar de transcribir (`autoApplyDefaultRecipe`), que corre server-side sin ningún
 * cliente escuchando el stream. Mismo modelo/prompt que el endpoint interactivo (`buildRecipeModelCall`
 * de acá arriba), solo que juntado en vez de transmitido.
 *
 * NUNCA lanza — mismo contrato best-effort que `generateTitleAndTags`/`translateText`/
 * `correctTextWithVocabulary`: cualquier falla (timeout, red, error del proveedor, salida vacía) se
 * traduce a `{ ok: false }`; el caller la trata como "no se pudo esta vez", nunca la propaga.
 */
export async function applyRecipeText(
  instruction: string,
  transcriptionText: string,
  timeoutMs: number = DEFAULT_RECIPE_TIMEOUT_MS
): Promise<ApplyRecipeTextResult> {
  try {
    const { text } = await generateText({
      ...buildRecipeModelCall(instruction, transcriptionText),
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "El modelo no devolvió contenido." };
    return { ok: true, text: trimmed };
  } catch (err) {
    // Cubre timeout (`AbortSignal.timeout` aborta la llamada, el AI SDK la repropaga como excepción),
    // red caída, y cualquier error del proveedor — mismo criterio best-effort que el resto de los
    // módulos de generación de esta app.
    return { ok: false, error: err instanceof Error ? err.message : "Error inesperado al aplicar el formato." };
  }
}
