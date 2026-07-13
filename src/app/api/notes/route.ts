import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { buildChatNoteDraft } from "@/lib/notes/chatNote";
import { DAILY_LIMIT, isOverDailyLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Crea una transcripción TEXT-ONLY (sin audio) a partir de texto arbitrario — hoy usado por
 * "Guardar como nota" en el chat (`chat-panel.tsx`, quick win del brainstorm "Sacar el output
 * afuera", ver ROADMAP.md) para guardar la respuesta de la IA como una nota nueva. Reusa la MISMA
 * tabla `transcriptions` (mismo patrón que `/api/transcribe`) sin ninguna migración: `audio_url` ya
 * es nullable en el esquema base (`supabase/migrations/20260706154044_init_schema.sql`, "Fase 2:
 * audio en Storage" siempre fue opcional) y `audio_name` — la única columna NOT NULL sin default
 * relacionada con audio — se completa con una etiqueta fija (`CHAT_NOTE_AUDIO_NAME`, ver
 * `src/lib/notes/chatNote.ts`) en vez de inventar un nombre de archivo. La fila queda con
 * `audio_url: null`/`audio_size: 0` y se distingue de una transcripción real con el tag "chat"
 * (`CHAT_NOTE_TAG`, reusa el modelo de tags existente — cero columnas nuevas) — aparece como chip
 * clickeable/filtrable en la lista y el detalle igual que cualquier otro tag.
 *
 * Ownership: `user_id` sale SIEMPRE de la sesión resuelta por `getApiUser` (cookies web o Bearer
 * del cliente desktop) — nunca de un campo del body — más la policy RLS "own transcriptions"
 * (`for all using/with check (auth.uid() = user_id)`, ver `init_schema.sql`) como segunda capa.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const draft = buildChatNoteDraft(typeof body.text === "string" ? body.text : "");
  if ("error" in draft) {
    return NextResponse.json({ error: draft.error }, { status: 400 });
  }

  // Límite diario COMPARTIDO con `/api/transcribe`: esta nota se inserta en la MISMA tabla
  // `transcriptions`, así que consume la MISMA cuota (no una separada). Mismo patrón fail-CLOSED
  // (ver comentario de `/api/transcribe`, corrección del review adversarial 2026-07-10, hallazgo
  // MEDIUM #4): si la query de conteo falla, NO se asume "0 consumido" — se corta con 503 en vez de
  // dejar pasar sin verificar.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount, error: dailyCountErr } = await supabase
    .from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneDayAgo);

  if (dailyCountErr) {
    console.error("[notes] daily limit count failed", {
      userId: user.id,
      error: dailyCountErr.message,
    });
    Sentry.captureException(new Error(dailyCountErr.message || "Error al verificar el límite diario."), {
      extra: { userId: user.id, stage: "daily-limit-count" },
    });
    return NextResponse.json(
      { error: "No pudimos verificar tu límite diario. Probá de nuevo." },
      { status: 503 }
    );
  }

  if (isOverDailyLimit(dailyCount ?? 0, DAILY_LIMIT)) {
    return NextResponse.json(
      { error: "Llegaste al límite diario de transcripciones. Probá mañana o escribinos." },
      { status: 429 }
    );
  }

  const baseRow = {
    user_id: user.id,
    title: draft.title,
    audio_name: draft.audio_name,
    audio_size: 0,
    audio_url: null,
    text: draft.text,
    icon: draft.icon,
  };

  // Mismo patrón expand/contract que `/api/transcribe`: `tags` es la columna más nueva
  // (`20260711160000_transcription_tags.sql`) — si todavía no está aplicada en este entorno
  // (`42703`), la nota se guarda igual, solo sin el tag distintivo (no bloquea el guardado por
  // algo puramente cosmético).
  let insertResult = await supabase
    .from("transcriptions")
    .insert({ ...baseRow, tags: draft.tags })
    .select("id")
    .single();

  if (insertResult.error && isMissingColumnError(insertResult.error)) {
    insertResult = await supabase.from("transcriptions").insert(baseRow).select("id").single();
  }

  const { data, error } = insertResult;
  if (error || !data) {
    console.error("[notes] insert failed", { userId: user.id, error: error?.message });
    return NextResponse.json({ error: "No se pudo guardar la nota." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, title: draft.title });
}
