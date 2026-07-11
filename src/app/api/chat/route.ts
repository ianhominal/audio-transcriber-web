import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { groq } from "@ai-sdk/groq";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import { CHAT_MODEL, CHAT_MAX_OUTPUT_TOKENS, buildChatSystemPrompt, isValidChatMessageText } from "@/lib/chat/config";
import { extractUiMessageText } from "@/lib/chat/messages";
import { isAiChatDailyLimitError } from "@/lib/aiUsage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Chat con IA sobre UNA transcripción (MVP por-transcripción, ver ROADMAP.md). Body:
 * `{ transcriptionId: string, messages: UIMessage[] }` — `messages` es el historial completo tal
 * como lo mantiene `useChat` (incluye el mensaje nuevo del usuario ya agregado en el cliente), mismo
 * criterio "el cliente manda el estado completo, el server no lo reconstruye" que ya usa `useChat`
 * por default (ver `src/app/app/t/[id]/chat-panel.tsx`).
 *
 * Ownership: RLS + lectura previa de la transcripción, mismo patrón que `/api/summarize` — nunca un
 * cliente service-role. Cap de costo: reserve-on-attempt en `ai_usage_log` (kind: "chat"), mismo
 * mecanismo atómico (trigger `BEFORE INSERT`) que el resumen. Historial: se persisten el mensaje del
 * usuario y la respuesta del assistant JUNTOS en `onFinish` (al terminar el stream), no antes — así
 * un pedido que nunca llega a generar respuesta (cap, error de Groq) no dopa el historial con un
 * mensaje de usuario huérfano sin respuesta.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "El servidor no tiene configurada la clave de Groq." },
      { status: 500 }
    );
  }

  let body: { transcriptionId?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const transcriptionId = typeof body.transcriptionId === "string" ? body.transcriptionId : "";
  if (!transcriptionId) {
    return NextResponse.json({ error: "Falta el id de la transcripción." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : null;
  const lastMessage = messages && messages.length > 0 ? messages[messages.length - 1] : null;
  if (!messages || messages.length === 0 || !lastMessage || lastMessage.role !== "user") {
    return NextResponse.json({ error: "Solicitud de chat inválida." }, { status: 400 });
  }

  const userText = extractUiMessageText(lastMessage);
  if (!isValidChatMessageText(userText)) {
    return NextResponse.json(
      { error: userText.trim() ? "Tu mensaje es muy largo." : "Escribí un mensaje antes de enviar." },
      { status: 400 }
    );
  }

  // 1) Traer la transcripción. RLS scopea por dueño (fila ajena/inexistente → `data: null` con
  //    `maybeSingle()`, sin error) — se trata como 404. Igual criterio que `/api/summarize`: solo se
  //    responde 404 ante ausencia real; cualquier OTRO error de la query es un 500, nunca se
  //    disfraza de "no encontrado".
  const { data: transcription, error: fetchError } = await supabase
    .from("transcriptions")
    .select("id, text")
    .eq("id", transcriptionId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; text: string | null }>();

  if (fetchError) {
    console.error("[chat] fetch failed", { userId: user.id, transcriptionId, error: fetchError.message });
    Sentry.captureException(new Error(fetchError.message || "Error al leer la transcripción."), {
      extra: { userId: user.id, transcriptionId, stage: "chat-fetch" },
    });
    return NextResponse.json({ error: "No se pudo leer la transcripción." }, { status: 500 });
  }

  if (!transcription) {
    return NextResponse.json({ error: "No se encontró la transcripción." }, { status: 404 });
  }

  const transcriptionText = (transcription.text ?? "").trim();
  if (!transcriptionText) {
    return NextResponse.json(
      { error: "Todavía no hay texto transcripto para charlar sobre esto." },
      { status: 400 }
    );
  }

  // 2) Cap de costo/abuso por usuario/24h — mismo mecanismo reserve-on-attempt + enforcement
  //    atómico en la DB que `/api/summarize` (ver `src/lib/aiUsage.ts`, migración
  //    `20260710140000_chat_messages.sql`): se intenta el INSERT en `ai_usage_log` ANTES de llamar a
  //    Groq, un trigger `BEFORE INSERT` cuenta y rechaza dentro de la misma transacción.
  const { error: usageLogErr } = await supabase
    .from("ai_usage_log")
    .insert({ user_id: user.id, kind: "chat" });

  if (usageLogErr) {
    if (isAiChatDailyLimitError(usageLogErr)) {
      return NextResponse.json(
        { error: "Llegaste al límite diario de mensajes de chat. Probá mañana." },
        { status: 429 }
      );
    }
    if (!isMissingTableError(usageLogErr)) {
      console.error("[chat] usage log insert failed", { userId: user.id, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId: user.id, stage: "chat-usage-log-insert" } });
      return NextResponse.json(
        { error: "No pudimos verificar tu límite diario. Probá de nuevo." },
        { status: 503 }
      );
    }
    // 42P01: `ai_usage_log` todavía sin migrar — degrada sin cap (ventana de rollout), mismo
    // criterio que `/api/summarize`.
  }

  // 3) Generación + streaming. `system` lleva el texto de la transcripción (recortado por
  //    `buildChatSystemPrompt`, ver `src/lib/chat/config.ts`) como única fuente de verdad del
  //    modelo. `maxOutputTokens` acota el costo de la respuesta (auditoría 2026-07-10, MEDIUM #3).
  const result = streamText({
    model: groq(CHAT_MODEL),
    system: buildChatSystemPrompt(transcriptionText),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
  });

  // Sigue consumiendo el stream aunque el cliente se desconecte (cierre de pestaña, red), para que
  // `onFinish` (y la persistencia del mensaje) corra igual — mismo patrón documentado por el AI SDK
  // para "Handling client disconnects".
  result.consumeStream();

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessage }) => {
      const assistantText = extractUiMessageText(responseMessage);

      // Se persisten juntos (mismo `insert` en lote) el mensaje del usuario que disparó este
      // request y la respuesta del assistant — recién ACÁ, al terminar el stream, no antes de
      // llamar a Groq. Si la respuesta quedó vacía (stream abortado sin texto, error temprano), no
      // se guarda ninguno de los dos: preferible perder un mensaje suelto a guardar una pregunta
      // sin su respuesta (rompería la alternancia user/assistant que espera `convertToModelMessages`
      // en el próximo request de esta conversación).
      if (!assistantText.trim()) return;

      const { error: persistError } = await supabase.from("chat_messages").insert([
        { transcription_id: transcriptionId, user_id: user.id, role: "user", content: userText },
        { transcription_id: transcriptionId, user_id: user.id, role: "assistant", content: assistantText },
      ]);

      if (persistError && !isMissingTableError(persistError)) {
        console.error("[chat] persist failed", { userId: user.id, transcriptionId, error: persistError.message });
        Sentry.captureException(persistError, { extra: { userId: user.id, transcriptionId, stage: "chat-persist" } });
        // Best-effort: la respuesta YA se le mandó a la usuaria en el stream, no tiene sentido
        // fallar el request por un problema de persistencia — solo no queda guardada en el
        // historial (se pierde al recargar), mismo criterio que la persistencia del resumen.
      }
    },
    onError: (error) => {
      console.error("[chat] stream error", { userId: user.id, transcriptionId, error });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: { userId: user.id, transcriptionId, stage: "chat-stream" },
      });
      // Nunca se reenvía el error crudo al cliente (podría filtrar detalles internos/del proveedor).
      return "No pudimos generar la respuesta. Probá de nuevo.";
    },
  });
}
