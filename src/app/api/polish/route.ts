import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import { listVocabularyTerms } from "@/lib/vocabulary/store";
import { isAiPolishDailyLimitError } from "@/lib/aiUsage";
import { buildPolishCall } from "@/lib/polish/prompt";
import { joinPolished, MAX_POLISH_INPUT_CHARS, splitForPolish } from "@/lib/polish/chunk";
import { joinSpeakerBlocks, type SpeakerBlock, splitSpeakerBlocks } from "@/lib/polish/speakers";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type PolishChunkResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Pule UN pedazo vía Groq (`buildPolishCall`, ver `src/lib/polish/prompt.ts`). Best-effort por
 * diseño, mismo criterio que `correctTextWithVocabulary`/`translateText`: cualquier falla (red,
 * HTTP, respuesta vacía/no-JSON, salida truncada por `max_tokens`) devuelve `{ ok: false }` con un
 * mensaje — NUNCA lanza. El caller (`POST` de abajo) decide qué hacer ante un fallo: acá el criterio
 * es "nunca perder texto", así que un pedazo que falla se reemplaza por su original sin pulir, nunca
 * se descarta.
 */
async function polishChunk(chunk: string, terms: string[], apiKey: string): Promise<PolishChunkResult> {
  let resp: Response;
  try {
    resp = await fetch(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPolishCall(chunk, terms)),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al servicio de pulido." };
  }

  const raw = await resp.text();
  let data: {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El servicio de pulido devolvió ${resp.status}.` };
  }

  // Truncado por `max_tokens` (mismo chequeo que `translateText`, ver `src/lib/translate/groq.ts`):
  // un pedazo cortado a la mitad por `finish_reason: "length"` perdería su cola en silencio si se
  // usara tal cual — se trata como fallo para que el caller conserve el pedazo ORIGINAL completo en
  // vez de una versión pulida pero incompleta.
  if (data.choices?.[0]?.finish_reason === "length") {
    return { ok: false, error: "El pulido de este tramo quedó incompleto (se cortó por longitud)." };
  }

  const polished = data.choices?.[0]?.message?.content?.trim();
  if (!polished) {
    return { ok: false, error: "El servicio de pulido no devolvió texto." };
  }
  return { ok: true, text: polished };
}

/**
 * Pule un texto largo (transcripción de Whisper local, o cualquier texto pegado por el usuario):
 * agrega puntuación/párrafos y corrige términos del vocabulario custom, en pedazos de a lo sumo
 * `POLISH_CHUNK_CHARS` (`src/lib/polish/chunk.ts`) — el corrector de `/api/transcribe` capea en
 * `MAX_CORRECTION_INPUT_CHARS` (12.000 caracteres) y por eso es inalcanzable para una reunión larga
 * o para texto que ya fue transcripto por otro medio (ver contexto del brief "Pulido de texto largo").
 *
 * Body: `{ text: string, transcriptionId?: string }`. `transcriptionId` es OPCIONAL: si viene, se
 * verifica ownership y el resultado se guarda en `transcriptions.text`; si no viene, el texto vuelve
 * en la respuesta sin persistir nada (uso "de paso", texto que ni siquiera está guardado todavía).
 *
 * Los pedazos se pulen SECUENCIALMENTE (no en paralelo): comparten la misma `GROQ_API_KEY` que el
 * resto de la app, y una transcripción larga puede significar varias decenas de llamadas — mandarlas
 * todas de una saturaría el rate-limit de Groq para todos los usuarios a la vez.
 *
 * Cap de costo/abuso: reserve-on-attempt en `ai_usage_log` (`kind: "polish"`) ANTES de pulir ningún
 * pedazo, UNA fila por request (no una por pedazo) — mismo mecanismo atómico que `/api/summarize`/
 * `/api/recipes/apply` (ver `src/lib/aiUsage.ts`). Hoy no existe un trigger de límite para este
 * `kind` (ver `isAiPolishDailyLimitError`); el INSERT igual sirve para tener el historial de uso
 * disponible el día que se decida agregar uno.
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

  let body: { text?: unknown; transcriptionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "No hay texto para pulir." }, { status: 400 });
  }
  if (text.length > MAX_POLISH_INPUT_CHARS) {
    return NextResponse.json(
      { error: "El texto es demasiado largo para pulirlo de una. Probá con un texto más corto." },
      { status: 400 }
    );
  }

  const transcriptionId = typeof body.transcriptionId === "string" ? body.transcriptionId : "";

  // 1) Ownership de la transcripción (si vino un id) — ANTES de gastar cuota/llamar a Groq, mismo
  //    criterio que `/api/recipes/apply`: no tiene sentido pulir y después descubrir que no se puede
  //    guardar porque el id no existe o es de otro usuario. RLS ya scopea por dueño (fila ajena o
  //    inexistente da `data: null` con `maybeSingle()`, sin error), MÁS un filtro explícito por
  //    `user_id` (defensa en profundidad, mismo patrón que el resto de la app).
  if (transcriptionId) {
    const { data: transcription, error: transcriptionError } = await supabase
      .from("transcriptions")
      .select("id")
      .eq("id", transcriptionId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();

    if (transcriptionError) {
      console.error("[polish] transcription fetch failed", {
        userId: user.id,
        transcriptionId,
        error: transcriptionError.message,
      });
      Sentry.captureException(new Error(transcriptionError.message || "Error al leer la transcripción."), {
        extra: { userId: user.id, transcriptionId, stage: "polish-transcription-fetch" },
      });
      return NextResponse.json({ error: "No se pudo leer la transcripción." }, { status: 500 });
    }
    if (!transcription) {
      return NextResponse.json({ error: "No se encontró la transcripción." }, { status: 404 });
    }
  }

  // 2) Vocabulario custom del usuario — best-effort, `listVocabularyTerms` ya degrada a `[]` ante
  //    cualquier error (tabla sin migrar, RLS, conexión), mismo criterio que `/api/transcribe`.
  const terms = (await listVocabularyTerms(supabase, user.id)).map((t) => t.term);

  // 3) Cap de costo/abuso por usuario/24h — reserve-on-attempt + enforcement atómico en la DB, mismo
  //    mecanismo que `/api/summarize`/`/api/recipes/apply` (ver `src/lib/aiUsage.ts`). Ramas del
  //    resultado del INSERT: límite alcanzado → 429; tabla todavía sin migrar (`42P01`,
  //    `isMissingTableError`) → degrada sin cap; cualquier OTRO error → fail-closed con 503 (no se
  //    arriesga una tanda de llamadas a Groq sin poder verificar el límite).
  const { error: usageLogErr } = await supabase.from("ai_usage_log").insert({ user_id: user.id, kind: "polish" });

  if (usageLogErr) {
    if (isAiPolishDailyLimitError(usageLogErr)) {
      return NextResponse.json(
        { error: "Llegaste al límite diario de textos pulidos. Probá de nuevo mañana." },
        { status: 429 }
      );
    }
    if (!isMissingTableError(usageLogErr)) {
      console.error("[polish] usage log insert failed", { userId: user.id, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId: user.id, stage: "polish-usage-log-insert" } });
      return NextResponse.json({ error: "No pudimos verificar tu límite diario. Probá de nuevo." }, { status: 503 });
    }
    // 42P01: `ai_usage_log` todavía sin migrar — degrada sin cap (ventana de rollout).
  }

  // 4) Pulir. Un pedazo que falla NUNCA se pierde: se conserva su texto ORIGINAL sin pulir y se
  //    sigue con el resto — el usuario se lleva como mínimo lo que ya tenía, nunca menos.
  const chunkErrors: string[] = [];
  let polishedCount = 0;
  let totalCount = 0;

  /** Pule un texto largo partiéndolo en pedazos (ver `splitForPolish`), secuencial. */
  const polishLongText = async (input: string): Promise<string> => {
    const chunks = splitForPolish(input);
    const out: string[] = [];
    for (const chunk of chunks) {
      totalCount++;
      const result = await polishChunk(chunk, terms, apiKey);
      if (result.ok) {
        out.push(result.text);
        polishedCount++;
      } else {
        console.error("[polish] chunk failed, keeping original text for that chunk", {
          userId: user.id,
          error: result.error,
        });
        chunkErrors.push(result.error);
        out.push(chunk);
      }
    }
    return joinPolished(out);
  };

  // Transcripción con hablantes ("Persona 1: …", ver `splitSpeakerBlocks`): se pule SOLO el texto de
  // cada turno y las etiquetas se re-adjuntan acá, sin pasar jamás por el modelo. Pedirle al LLM
  // "conservá las etiquetas" sería un pedido, no una garantía: reorganiza, fusiona turnos y
  // renombra. Lo que no se puede perder, no se manda.
  const speakerBlocks = splitSpeakerBlocks(text);
  let finalText: string;

  if (speakerBlocks) {
    const polishedBlocks: SpeakerBlock[] = [];
    for (const block of speakerBlocks) {
      polishedBlocks.push({ label: block.label, text: await polishLongText(block.text) });
    }
    finalText = joinSpeakerBlocks(polishedBlocks);
  } else {
    finalText = await polishLongText(text);
  }

  // Un solo evento de Sentry por request (no uno por pedazo fallido): una transcripción larga puede
  // tener varias decenas de pedazos y no aporta nada generar ese mismo múltiplo de eventos.
  if (chunkErrors.length > 0) {
    Sentry.captureException(new Error(`polish: ${chunkErrors.length}/${totalCount} chunks failed`), {
      extra: { userId: user.id, transcriptionId: transcriptionId || null, firstError: chunkErrors[0] },
    });
  }

  // 5) Persistir (si vino `transcriptionId`) — best-effort, mismo criterio que `/api/summarize`: si
  //    el UPDATE falla, el texto pulido SIGUE llegando al usuario en la respuesta (nunca se pierde
  //    el trabajo ya hecho); el cliente lo deja en el textarea sin tocar el `baseline` de "guardado",
  //    así que el botón "Guardar" ya existente queda disponible para reintentar la persistencia.
  if (transcriptionId) {
    const { error: updateError } = await supabase
      .from("transcriptions")
      .update({ text: finalText })
      .eq("id", transcriptionId)
      .eq("user_id", user.id)
      .is("deleted_at", null);

    if (updateError) {
      console.error("[polish] persist failed", {
        userId: user.id,
        transcriptionId,
        error: updateError.message,
      });
      Sentry.captureException(updateError, {
        extra: { userId: user.id, transcriptionId, stage: "polish-persist" },
      });
    }
  }

  return NextResponse.json({ text: finalText, polishedChunks: polishedCount, totalChunks: totalCount });
}
