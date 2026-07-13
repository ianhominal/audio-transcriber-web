import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { streamText } from "ai";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import { isAiMergeDailyLimitError } from "@/lib/aiUsage";
import { canMergeNoteCount, combineNoteTexts, sanitizeMergeInstruction } from "@/lib/merge/validate";
import { buildMergeModelCall } from "@/lib/merge/apply";
import type { MergeSourceNote } from "@/lib/merge/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Merges several notes (transcriptions) from the same project into a single AI-generated document:
 * `{ transcriptionIds: string[], instruction?: string }` → builds the final prompt
 * (`buildMergePrompt`) and sends it to Groq, returning the response as streaming plain text — same
 * streaming/error-handling pattern as `/api/recipes/apply` (single-shot, no message history,
 * `toTextStreamResponse()`), with no automatic persistence ("Save as note" is an EXPLICIT user action
 * via `/api/notes`, same as "Apply format").
 *
 * OWNERSHIP — anti-IDOR: notes are ALWAYS read scoped to `user_id` (in addition to RLS, defense in
 * depth, same criteria as the rest of the app). If ANY of the requested ids doesn't show up in the
 * result (doesn't exist, is deleted, or belongs to another user), the WHOLE request fails with a
 * GENERIC 404 — it never reveals which id is the problem, nor does it proceed with a subset (a
 * foreign id mixed into the array can never leak someone else's content into the final document).
 * Same criteria as the generic 404 in `/api/recipes/apply`.
 *
 * Cost cap: reserve-on-attempt on `ai_usage_log` (`kind: "merge"`) BEFORE calling Groq, same atomic
 * mechanism (`BEFORE INSERT` trigger, see `src/lib/aiUsage.ts` and migration
 * `20260713140000_ai_usage_merge.sql`) as the rest of this app's AI features.
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

  let body: { transcriptionIds?: unknown; instruction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const rawIds = Array.isArray(body.transcriptionIds) ? body.transcriptionIds : [];
  const dedupedIds = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!canMergeNoteCount(dedupedIds.length)) {
    return NextResponse.json({ error: "Elegí entre 2 y 20 notas para unir." }, { status: 400 });
  }

  // Ownership — anti-IDOR (see header comment): scoped to `user_id` in addition to RLS. If the count
  // of returned rows doesn't match EXACTLY the number of requested (deduplicated) ids, at least one
  // doesn't exist, is deleted, or belongs to another user — the WHOLE request is rejected with a
  // generic 404, never processing a subset nor revealing which id failed.
  const { data: notes, error: notesErr } = await supabase
    .from("transcriptions")
    .select("id, title, text, created_at")
    .in("id", dedupedIds)
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (notesErr) {
    console.error("[notes-merge] notes fetch failed", { userId: user.id, error: notesErr.message });
    Sentry.captureException(new Error(notesErr.message || "Error al leer las notas."), {
      extra: { userId: user.id, stage: "notes-merge-fetch" },
    });
    return NextResponse.json({ error: "No se pudieron leer las notas." }, { status: 500 });
  }

  if (!notes || notes.length !== dedupedIds.length) {
    return NextResponse.json({ error: "No pudimos encontrar alguna de las notas elegidas." }, { status: 404 });
  }

  const instruction = sanitizeMergeInstruction(body.instruction);
  const sourceNotes: MergeSourceNote[] = (
    notes as { id: string; title: string | null; text: string | null; created_at: string }[]
  ).map((n) => ({
    id: n.id,
    title: n.title ?? "Sin título",
    createdAt: n.created_at,
    text: n.text ?? "",
  }));

  const { combinedText, truncated, includedCount } = combineNoteTexts(sourceNotes);
  if (!combinedText.trim()) {
    return NextResponse.json({ error: "Las notas elegidas no tienen contenido para unir." }, { status: 400 });
  }

  // Cost/abuse cap per user/24h — same reserve-on-attempt mechanism as `/api/recipes/apply` (see
  // `src/lib/aiUsage.ts`, migration `20260713140000_ai_usage_merge.sql`): the INSERT into
  // `ai_usage_log` is attempted BEFORE calling Groq.
  const { error: usageLogErr } = await supabase.from("ai_usage_log").insert({ user_id: user.id, kind: "merge" });

  if (usageLogErr) {
    if (isAiMergeDailyLimitError(usageLogErr)) {
      return NextResponse.json(
        { error: "Llegaste al límite diario de uniones. Probá de nuevo mañana." },
        { status: 429 }
      );
    }
    if (!isMissingTableError(usageLogErr)) {
      console.error("[notes-merge] usage log insert failed", { userId: user.id, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId: user.id, stage: "notes-merge-usage-log-insert" } });
      return NextResponse.json({ error: "No pudimos verificar tu límite diario. Probá de nuevo." }, { status: 503 });
    }
    // 42P01: `ai_usage_log` not migrated yet — degrade without a cap (rollout window), same
    // criteria as `/api/recipes/apply`/`/api/chat`.
  }

  // Generation + streaming. Single-shot (no `messages`/history), same single-source-of-truth helper
  // as `buildRecipeModelCall` (see `src/lib/merge/apply.ts`).
  const result = streamText({
    ...buildMergeModelCall(instruction, combinedText),
    onError: (error) => {
      console.error("[notes-merge] stream error", { userId: user.id, error });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: { userId: user.id, stage: "notes-merge-stream" },
      });
      // The raw error is never forwarded to the client (could leak internal/provider details).
    },
  });

  // Keeps consuming the stream even if the client disconnects, same defensive pattern as
  // `/api/recipes/apply`/`/api/chat`.
  result.consumeStream();

  const response = result.toTextStreamResponse();
  // Extra headers so the client knows about truncation WITHOUT having to parse the plain-text stream
  // (which carries no embedded marker) — see `merge-view.tsx`, which reads them off the `Response`
  // BEFORE consuming the body.
  response.headers.set("X-Merge-Truncated", String(truncated));
  response.headers.set("X-Merge-Included-Count", String(includedCount));
  return response;
}
