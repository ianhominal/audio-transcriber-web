import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { translationLanguageLabel } from "@/lib/translate/languages";
import { summarizeText } from "@/lib/summary/groq";
import { parseStoredSummary, serializeSummary } from "@/lib/summary/format";
import { canSummarizeText } from "@/lib/summary/validate";
import { hashSummarySource } from "@/lib/summary/hash";

export const runtime = "nodejs";
export const maxDuration = 30;

const CORE_COLUMNS = "id, text, language";
const COLUMNS_WITH_TRANSLATION = `${CORE_COLUMNS}, translated_to`;
// `summary`/`summary_source_hash` (Fase F5, ver supabase/migrations/20260709220000_transcription_summary.sql)
// se aplican automático recién al pushear a `main` — igual criterio que `translated_to` (F4) y
// `color` (F2). Se intenta con TODAS las columnas nuevas primero y se cae en cascada, mismo patrón
// que el dedupe de `/api/transcribe`.
const COLUMNS_WITH_SUMMARY = `${COLUMNS_WITH_TRANSLATION}, summary, summary_source_hash`;

type TranscriptionRow = {
  id: string;
  text: string | null;
  language: string;
  translated_to?: string | null;
  summary?: string | null;
  summary_source_hash?: string | null;
};

/**
 * Genera (o devuelve cacheado) el resumen con IA de una transcripción — Fase F5, ver
 * ROADMAP.md. Requiere sesión; el ownership lo resuelve RLS ("own transcriptions"), no un filtro
 * `user_id` explícito acá — mismo criterio que el resto de las mutaciones sobre `transcriptions`
 * en `src/app/app/actions.ts`.
 *
 * Body: `{ id: string, force?: boolean }`. `force: true` ignora el resumen cacheado (si lo hay) y
 * vuelve a llamar al LLM — es el botón "Regenerar" del detalle.
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

  let body: { id?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Falta el id de la transcripción." }, { status: 400 });
  }
  const force = body.force === true;

  // 1) Traer la transcripción. RLS ya scopea por dueño (una fila ajena o inexistente da
  //    `data: null` con `maybeSingle()`, sin error) — se trata como 404 más abajo. Cascada de
  //    compat de esquema en 3 niveles: con resumen (F5) → con traducción (F4) sin resumen → solo
  //    columnas base, para no perder `translated_to` innecesariamente si el ÚNICO faltante es F5.
  //    IMPORTANTE (corrección del review): solo se BAJA de nivel ante un `42703` (columna
  //    inexistente). Cualquier OTRO error (RLS, conexión, timeout) NO es "no encontrado" — se
  //    guarda en `fetchError` y se responde 5xx, para no disfrazar una falla real de un 404.
  let row: TranscriptionRow | null = null;
  let fetchError: { message?: string } | null = null;
  {
    const withSummary = await supabase
      .from("transcriptions")
      .select(COLUMNS_WITH_SUMMARY)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!withSummary.error) {
      row = withSummary.data ?? null;
    } else if (isMissingColumnError(withSummary.error)) {
      const withTranslation = await supabase
        .from("transcriptions")
        .select(COLUMNS_WITH_TRANSLATION)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!withTranslation.error) {
        row = withTranslation.data ? { ...withTranslation.data, summary: null, summary_source_hash: null } : null;
      } else if (isMissingColumnError(withTranslation.error)) {
        const base = await supabase
          .from("transcriptions")
          .select(CORE_COLUMNS)
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!base.error) {
          row = base.data
            ? { ...base.data, translated_to: null, summary: null, summary_source_hash: null }
            : null;
        } else {
          fetchError = base.error;
        }
      } else {
        fetchError = withTranslation.error;
      }
    } else {
      fetchError = withSummary.error;
    }
  }

  if (fetchError) {
    console.error("[summarize] fetch failed", { userId: user.id, transcriptionId: id, error: fetchError.message });
    Sentry.captureException(new Error(fetchError.message || "Error al leer la transcripción."), {
      extra: { userId: user.id, transcriptionId: id, stage: "summarize-fetch" },
    });
    return NextResponse.json({ error: "No se pudo leer la transcripción." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "No se encontró la transcripción." }, { status: 404 });
  }

  const text = (row.text ?? "").trim();
  if (!canSummarizeText(text)) {
    return NextResponse.json({ error: "El texto es muy corto para resumir." }, { status: 400 });
  }

  // 2) Resumen cacheado: si ya hay uno guardado y corresponde al texto ACTUAL (mismo hash), se
  //    devuelve sin llamar a Groq de nuevo — salvo `force` (botón "Regenerar" del detalle).
  const currentHash = hashSummarySource(text);
  if (!force && row.summary && row.summary_source_hash === currentHash) {
    const cached = parseStoredSummary(row.summary);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }
    // `summary` guardado con forma inesperada (fila vieja/corrupta): no aborta, sigue abajo como
    // si no hubiera cache y regenera.
  }

  // 3) Idioma del resumen: el del texto FINAL de la transcripción.
  //    - Si se tradujo (F4): el idioma destino de esa traducción (siempre uno concreto).
  //    - Si no, y el idioma de transcripción es concreto (es/en): ese.
  //    - Si el idioma es "auto" (Whisper lo detectó, no lo sabemos acá): `null` → `summarizeText`
  //      le pide al modelo resumir en el MISMO idioma que el texto. Corrección del review: antes se
  //      forzaba español a todo lo que no fuera "en", lo que rompía un audio en francés/portugués/etc.
  const languageLabel =
    row.translated_to
      ? translationLanguageLabel(row.translated_to)
      : row.language && row.language !== "auto"
        ? translationLanguageLabel(row.language)
        : null;

  const result = await summarizeText(text, languageLabel, apiKey);
  if (!result.ok) {
    console.error("[summarize] failed", { userId: user.id, transcriptionId: id, error: result.error });
    Sentry.captureException(new Error(result.error), {
      extra: { userId: user.id, transcriptionId: id, stage: "summarize" },
    });
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // 4) Persistir (best-effort): si `summary`/`summary_source_hash` todavía no existen en el
  //    esquema real, el resumen SIGUE llegando al usuario en la respuesta — solo no queda
  //    cacheado hasta que la migración se aplique (mismo criterio que F4 con `translated_to`).
  const { error: updateError } = await supabase
    .from("transcriptions")
    .update({ summary: serializeSummary(result.summary), summary_source_hash: currentHash })
    .eq("id", id);

  if (updateError && !isMissingColumnError(updateError)) {
    console.error("[summarize] persist failed", {
      userId: user.id,
      transcriptionId: id,
      error: updateError.message,
    });
    Sentry.captureException(updateError, {
      extra: { userId: user.id, transcriptionId: id, stage: "summarize-persist" },
    });
  }

  return NextResponse.json({ ...result.summary, cached: false });
}
