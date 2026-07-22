import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { streamText, type UIMessage } from "ai";
import { groq } from "@ai-sdk/groq";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/schema-compat";
import { isAiBrainDailyLimitError } from "@/lib/aiUsage";
import { buildIlikeOrFilter } from "@/lib/search/query";
import {
  BRAIN_MODEL,
  BRAIN_MAX_OUTPUT_TOKENS,
  MAX_BRAIN_QUESTION_CHARS,
  RETRIEVAL_TOP_K,
  isValidBrainQuestionText,
  buildBrainSystemPrompt,
} from "@/lib/brain/config";
import {
  buildRetrievalFilters,
  buildBrainContext,
  shouldFetchRecentFallback,
  mergeWithRecentNotes,
  type BrainSourceNote,
} from "@/lib/brain/retrieval";
import { extractUiMessageText } from "@/lib/chat/messages";

export const runtime = "nodejs";
export const maxDuration = 30;

type NoteRow = { id: string; title: string | null; text: string | null; summary: string | null; created_at: string };

/** Validates an optional `projectId` in the request body (chat scope "project" — "Este proyecto").
 * Defensive on purpose: a malformed value is REJECTED with 400 rather than silently ignored or
 * passed through to Supabase as-is — same criteria as `TRANSCRIPTION_ID_SCHEMA`
 * (`src/lib/mcp/tools.ts`), catching a bad id here instead of letting it reach Postgres as an
 * "invalid input syntax for type uuid" error. This is scoping-only, never identity: the user id used
 * for every query in this route still comes exclusively from `getApiUser(req)` (see header comment)
 * — `projectId` can only narrow within that user's own already-scoped rows. */
const PROJECT_ID_SCHEMA = z.uuid();

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — ask the AI a question grounded in ALL of the
 * user's notes, not just one. `POST { message: UIMessage }` (the current question only — see below),
 * streamed response.
 *
 * STATELESS on purpose (no conversation history, no persistence table): unlike `/api/chat`
 * (per-transcription, reconstructs history server-side from `chat_messages`), there is no natural
 * anchor to persist a Segundo cerebro conversation under, and accepting a client-supplied history
 * array here would reintroduce the EXACT vulnerability `/api/chat` was fixed for (see its header
 * comment) — a caller could fabricate an arbitrarily large fake history, inflating the cost of a
 * single request past what `ai_usage_log`'s per-request cap accounts for, or inject fake
 * `system`/`assistant` turns to bypass grounding. So this route only ever looks at ONE user message
 * per request; the client (`brain-chat.tsx`) still shows a running conversation locally, but each
 * question is answered independently — multi-turn memory is a follow-up (documented in ROADMAP.md
 * alongside semantic search), not silently faked with an unsafe shortcut.
 *
 * OWNERSHIP — anti-IDOR: retrieval is built via `buildRetrievalFilters(user.id, question)`
 * (`src/lib/brain/retrieval.ts`), where `user.id` comes ONLY from `getApiUser(req)` (the authenticated
 * session) — never from the request body — and applied as `.eq("user_id", filters.userId)` in
 * ADDITION to RLS (defense in depth, same criteria as `/api/notes/search` and `/api/notes/merge`).
 * There is no code path anywhere in this route that lets `question` influence which user's notes get
 * read.
 *
 * Cost cap: reserve-on-attempt on `ai_usage_log` (`kind: "brain"`) BEFORE calling Groq, same atomic
 * mechanism (`BEFORE INSERT` trigger, migration `20260713160000_ai_usage_brain.sql`) as the rest of
 * this app's AI features. Runs AFTER retrieval (a free DB read) so a user already at their cap
 * doesn't get charged for a request that's about to be rejected anyway, but BEFORE the actual Groq
 * call — same ordering criteria as `/api/chat`/`/api/notes/merge`.
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

  let body: { message?: unknown; projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  // Scope "project" ("Este proyecto"): `projectId` es OPCIONAL y solo ACOTA la búsqueda dentro de
  // las notas ya scopeadas por `user_id` más abajo — nunca sustituye ese filtro ni participa en la
  // identidad del pedido (ver comentario de `PROJECT_ID_SCHEMA`). Si viene pero no es un UUID válido,
  // se rechaza con 400 en vez de ignorarlo silenciosamente o dejarlo pasar tal cual a Supabase.
  let projectId: string | undefined;
  if (body.projectId !== undefined && body.projectId !== null) {
    const parsedProjectId = PROJECT_ID_SCHEMA.safeParse(body.projectId);
    if (!parsedProjectId.success) {
      return NextResponse.json({ error: "El proyecto indicado no es válido." }, { status: 400 });
    }
    projectId = parsedProjectId.data;
  }

  // Misma validación ESTRICTA que `/api/chat`: solo se acepta un objeto con `role: "user"` (nunca
  // `assistant`/`system` impersonados) y se reconstruye un `UIMessage` LIMPIO a partir del texto ya
  // extraído, no de `parts` tal como llegó.
  const rawMessage = body.message;
  const rawRole = rawMessage && typeof rawMessage === "object" ? (rawMessage as { role?: unknown }).role : null;
  if (!rawMessage || typeof rawMessage !== "object" || rawRole !== "user") {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const questionText = extractUiMessageText(
    rawMessage as { parts?: readonly { type: string; text?: unknown }[] }
  ).trim();
  if (!isValidBrainQuestionText(questionText)) {
    return NextResponse.json(
      {
        error: questionText
          ? `Tu pregunta es muy larga (máximo ${MAX_BRAIN_QUESTION_CHARS.toLocaleString("es-AR")} caracteres).`
          : "Escribí una pregunta antes de enviar.",
      },
      { status: 400 }
    );
  }

  // 1) Retrieval: FTS por las notas del usuario más relacionadas con la pregunta (ver comentario de
  //    ownership arriba). Operación de lectura barata, corre ANTES del cap de costo — mismo criterio
  //    que la lectura de la transcripción en `/api/chat`.
  const filters = buildRetrievalFilters(user.id, questionText, projectId);
  const runFtsRetrieval = () => {
    let query = supabase
      .from("transcriptions")
      .select("id, title, text, summary, created_at")
      .eq("user_id", filters.userId)
      .is("deleted_at", null)
      .textSearch("search_vector", filters.searchQuery, { type: "websearch", config: "spanish" });
    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    return query.order("created_at", { ascending: false }).limit(filters.limit);
  };

  let retrievalData: NoteRow[] | null;
  const { data: ftsData, error: ftsError } = await runFtsRetrieval();

  if (!ftsError) {
    retrievalData = ftsData as unknown as NoteRow[];
  } else if (isMissingColumnError(ftsError)) {
    // `search_vector` todavía sin migrar (ventana de rollout) — degrada a `ilike`, mismo criterio y
    // misma función de escape que `/api/notes/search`.
    let ilikeQuery = supabase
      .from("transcriptions")
      .select("id, title, text, summary, created_at")
      .eq("user_id", filters.userId)
      .is("deleted_at", null)
      .or(buildIlikeOrFilter(filters.searchQuery, ["title", "text", "summary"]));
    if (filters.projectId) ilikeQuery = ilikeQuery.eq("project_id", filters.projectId);
    const { data: fallbackData, error: fallbackError } = await ilikeQuery
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (fallbackError) {
      console.error("[brain] retrieval fallback failed", { userId: user.id, error: fallbackError.message });
      Sentry.captureException(new Error(fallbackError.message || "Error al buscar notas."), {
        extra: { userId: user.id, stage: "brain-retrieval-fallback" },
      });
      return NextResponse.json({ error: "No se pudieron buscar tus notas." }, { status: 500 });
    }
    retrievalData = fallbackData as unknown as NoteRow[];
  } else {
    console.error("[brain] retrieval failed", { userId: user.id, error: ftsError.message });
    Sentry.captureException(new Error(ftsError.message || "Error al buscar notas."), {
      extra: { userId: user.id, stage: "brain-retrieval" },
    });
    return NextResponse.json({ error: "No se pudieron buscar tus notas." }, { status: 500 });
  }

  const sourceNotes: BrainSourceNote[] = (retrievalData ?? []).map((row) => ({
    id: row.id,
    title: row.title ?? "",
    createdAt: row.created_at,
    text: row.text ?? "",
    summary: row.summary,
  }));

  // 1.5) Fallback a las notas más recientes cuando el FTS trajo poco (ver comentario de
  //      `MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK` en `src/lib/brain/config.ts`): la búsqueda por
  //      palabras clave no encuentra nada si la pregunta no comparte vocabulario con las notas, aunque
  //      estas SÍ podrían responderla — es un PALIATIVO, no un reemplazo de búsqueda semántica.
  //      Lectura de solo lectura y BEST-EFFORT: si falla, seguimos con lo que el FTS ya trajo, nunca
  //      bloquea el request por esto. Corre ANTES del cap de costo (paso 2, más abajo) — es una
  //      lectura gratis, no consume el cap diario de llamadas a Groq.
  let finalSourceNotes = sourceNotes;
  if (shouldFetchRecentFallback(sourceNotes.length)) {
    let recentQuery = supabase
      .from("transcriptions")
      .select("id, title, text, summary, created_at")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (filters.projectId) recentQuery = recentQuery.eq("project_id", filters.projectId);
    const { data: recentData, error: recentError } = await recentQuery
      .order("created_at", { ascending: false })
      .limit(RETRIEVAL_TOP_K);

    if (recentError) {
      console.error("[brain] recent-notes fallback failed", { userId: user.id, error: recentError.message });
      Sentry.captureException(new Error(recentError.message || "Error al buscar notas recientes."), {
        extra: { userId: user.id, stage: "brain-recent-fallback" },
      });
    } else {
      const recentSourceNotes: BrainSourceNote[] = ((recentData ?? []) as unknown as NoteRow[]).map((row) => ({
        id: row.id,
        title: row.title ?? "",
        createdAt: row.created_at,
        text: row.text ?? "",
        summary: row.summary,
      }));
      finalSourceNotes = mergeWithRecentNotes(sourceNotes, recentSourceNotes);
    }
  }

  const { contextText } = buildBrainContext(finalSourceNotes);

  // 1.6) Nombre del proyecto para el system prompt (scope "project" — "Este proyecto"), best-effort:
  //      SOLO afecta cómo se redacta el prompt, nunca qué notas se leyeron (eso ya quedó resuelto
  //      arriba). Mismo patrón RLS + filtro explícito redundante que el resto de la ruta —
  //      `.eq("user_id", user.id)` viene de la sesión autenticada, nunca del body. Si falla o no
  //      encuentra el proyecto (por ejemplo, uno borrado), seguimos sin nombre en vez de romper la
  //      respuesta por un dato puramente cosmético.
  let projectName: string | undefined;
  if (filters.projectId) {
    const { data: projectRow, error: projectError } = await supabase
      .from("projects")
      .select("name")
      .eq("id", filters.projectId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (projectError) {
      console.error("[brain] project name lookup failed", { userId: user.id, error: projectError.message });
    } else {
      projectName = (projectRow as { name: string } | null)?.name ?? undefined;
    }
  }

  // 2) Cap de costo/abuso por usuario/24h — reserve-on-attempt, mismo mecanismo atómico que el resto
  //    de las features IA de esta app (ver header comment).
  const { error: usageLogErr } = await supabase
    .from("ai_usage_log")
    .insert({ user_id: user.id, kind: "brain" });

  if (usageLogErr) {
    if (isAiBrainDailyLimitError(usageLogErr)) {
      return NextResponse.json(
        { error: "Llegaste al límite diario de preguntas al Chat con IA sobre todas tus notas. Probá mañana." },
        { status: 429 }
      );
    }
    if (!isMissingTableError(usageLogErr)) {
      console.error("[brain] usage log insert failed", { userId: user.id, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId: user.id, stage: "brain-usage-log-insert" } });
      return NextResponse.json(
        { error: "No pudimos verificar tu límite diario. Probá de nuevo." },
        { status: 503 }
      );
    }
    // 42P01: `ai_usage_log` todavía sin migrar — degrada sin cap (ventana de rollout), mismo criterio
    // que el resto de las features IA.
  }

  // 3) Generación + streaming. Un único mensaje de usuario (sin historial, ver header comment); el
  //    contexto grounding va en `system` (`buildBrainSystemPrompt`, ya cubre el caso "no se encontró
  //    ninguna nota" cuando `contextText` viene vacío).
  const rawId = (rawMessage as { id?: unknown }).id;
  const newUserMessage: UIMessage = {
    id: typeof rawId === "string" && rawId ? rawId : randomUUID(),
    role: "user",
    parts: [{ type: "text", text: questionText }],
  };

  const result = streamText({
    model: groq(BRAIN_MODEL),
    system: buildBrainSystemPrompt(contextText, projectName),
    prompt: questionText,
    maxOutputTokens: BRAIN_MAX_OUTPUT_TOKENS,
  });

  result.consumeStream();

  return result.toUIMessageStreamResponse({
    originalMessages: [newUserMessage],
    onError: (error) => {
      console.error("[brain] stream error", { userId: user.id, error });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: { userId: user.id, stage: "brain-stream" },
      });
      return "No pudimos generar la respuesta. Probá de nuevo.";
    },
  });
}
