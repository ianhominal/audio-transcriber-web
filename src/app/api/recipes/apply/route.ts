import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import { isAiRecipeDailyLimitError } from "@/lib/aiUsage";
import { buildRecipePrompt } from "@/lib/recipes/validate";

export const runtime = "nodejs";
export const maxDuration = 30;

// Mismo modelo que el chat (`CHAT_MODEL`, `src/lib/chat/config.ts`) — no se importa la constante
// para no acoplar `recipes` a `chat` (dos features independientes que hoy comparten proveedor/modelo
// por casualidad, no por diseño): "aplicar un formato" es, como el chat, generación de calidad
// conversacional/redaccional (un brief, una escaleta), no una tarea estructurada corta como el
// resumen (que sí usa el modelo barato `llama-3.1-8b-instant`).
const RECIPE_MODEL = "llama-3.3-70b-versatile";

/**
 * Aplica un "Formato" (instrucción reutilizable, ver brief "Formatos" 2026-07-13) a UNA
 * transcripción: `{ transcriptionId, recipeId }` → arma el prompt final (`buildRecipePrompt`) y lo
 * manda a Groq, devolviendo la respuesta como texto plano en streaming. Generación single-shot (sin
 * historial de mensajes, a diferencia de `/api/chat`) — por eso usa `toTextStreamResponse()` en vez
 * del stream de `UIMessage` del chat, y no hay persistencia de resultado (MVP: "Guardar como nota" es
 * una acción EXPLÍCITA del usuario vía `/api/notes`, no algo que este endpoint haga solo).
 *
 * Ownership doble: la transcripción Y el formato deben pertenecer al usuario autenticado — ninguno de
 * los dos alcanza con "existe", cada uno se lee scopeado a `user_id` (además de RLS, defensa en
 * profundidad, mismo criterio que el resto de la app). Cap de costo: reserve-on-attempt en
 * `ai_usage_log` (`kind: "recipe"`) ANTES de llamar a Groq, mismo mecanismo atómico que
 * `/api/chat`/`/api/summarize` (ver `src/lib/aiUsage.ts`).
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "El servidor no tiene configurada la clave de Groq." }, { status: 500 });
  }

  let body: { transcriptionId?: unknown; recipeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const transcriptionId = typeof body.transcriptionId === "string" ? body.transcriptionId : "";
  const recipeId = typeof body.recipeId === "string" ? body.recipeId : "";
  if (!transcriptionId || !recipeId) {
    return NextResponse.json({ error: "Falta el formato o la transcripción." }, { status: 400 });
  }

  // 1) Ownership de la transcripción — RLS scopea por dueño (fila ajena/inexistente → `data: null`
  //    con `maybeSingle()`, sin error, se trata como 404), MÁS un filtro explícito por `user_id`
  //    (defensa en profundidad, mismo patrón que `/api/chat`).
  const { data: transcription, error: transcriptionError } = await supabase
    .from("transcriptions")
    .select("id, text")
    .eq("id", transcriptionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; text: string | null }>();

  if (transcriptionError) {
    console.error("[recipes-apply] transcription fetch failed", {
      userId: user.id,
      transcriptionId,
      error: transcriptionError.message,
    });
    Sentry.captureException(new Error(transcriptionError.message || "Error al leer la transcripción."), {
      extra: { userId: user.id, transcriptionId, stage: "recipe-apply-transcription-fetch" },
    });
    return NextResponse.json({ error: "No se pudo leer la transcripción." }, { status: 500 });
  }
  if (!transcription) {
    return NextResponse.json({ error: "No se encontró la transcripción." }, { status: 404 });
  }

  const transcriptionText = (transcription.text ?? "").trim();
  if (!transcriptionText) {
    return NextResponse.json({ error: "Todavía no hay texto transcripto para aplicar un formato." }, { status: 400 });
  }

  // 2) Ownership del formato — mismo criterio que arriba: scopeado a `user_id` además de RLS.
  const { data: recipe, error: recipeError } = await supabase
    .from("ai_recipes")
    .select("id, instruction")
    .eq("id", recipeId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; instruction: string }>();

  if (recipeError) {
    if (isMissingTableError(recipeError)) {
      return NextResponse.json({ error: "Todavía no hay formatos disponibles." }, { status: 404 });
    }
    console.error("[recipes-apply] recipe fetch failed", { userId: user.id, recipeId, error: recipeError.message });
    Sentry.captureException(new Error(recipeError.message || "Error al leer el formato."), {
      extra: { userId: user.id, recipeId, stage: "recipe-apply-recipe-fetch" },
    });
    return NextResponse.json({ error: "No se pudo leer el formato." }, { status: 500 });
  }
  if (!recipe) {
    return NextResponse.json({ error: "No se encontró el formato." }, { status: 404 });
  }

  // 3) Cap de costo/abuso por usuario/24h — mismo mecanismo reserve-on-attempt + enforcement atómico
  //    en la DB que `/api/chat` (ver `src/lib/aiUsage.ts`, migración `20260713120000_ai_recipes.sql`):
  //    se intenta el INSERT en `ai_usage_log` ANTES de llamar a Groq.
  const { error: usageLogErr } = await supabase.from("ai_usage_log").insert({ user_id: user.id, kind: "recipe" });

  if (usageLogErr) {
    if (isAiRecipeDailyLimitError(usageLogErr)) {
      return NextResponse.json(
        { error: "Llegaste al límite de formatos aplicados por hoy. Probá de nuevo mañana." },
        { status: 429 }
      );
    }
    if (!isMissingTableError(usageLogErr)) {
      console.error("[recipes-apply] usage log insert failed", { userId: user.id, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId: user.id, stage: "recipe-apply-usage-log-insert" } });
      return NextResponse.json({ error: "No pudimos verificar tu límite diario. Probá de nuevo." }, { status: 503 });
    }
    // 42P01: `ai_usage_log` todavía sin migrar — degrada sin cap (ventana de rollout), mismo criterio
    // que `/api/chat`.
  }

  // 4) Generación + streaming. Single-shot (sin `messages`/historial) — `buildRecipePrompt` arma la
  //    instrucción del usuario + el texto de la nota (recortado) en un único prompt.
  const result = streamText({
    model: groq(RECIPE_MODEL),
    prompt: buildRecipePrompt(recipe.instruction, transcriptionText),
    onError: (error) => {
      console.error("[recipes-apply] stream error", { userId: user.id, transcriptionId, recipeId, error });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: { userId: user.id, transcriptionId, recipeId, stage: "recipe-apply-stream" },
      });
      // Nunca se reenvía el error crudo al cliente (podría filtrar detalles internos/del proveedor).
    },
  });

  // Sigue consumiendo el stream aunque el cliente se desconecte, mismo patrón defensivo que
  // `/api/chat` (documentado por el AI SDK para "Handling client disconnects").
  result.consumeStream();

  return result.toTextStreamResponse();
}
