import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "crypto";
import { getApiUser } from "@/lib/supabase/api";
import {
  AUDIO_BUCKET,
  audioExtension,
  buildAudioObjectPath,
  uploadWithRetry,
  UPLOAD_MAX_ATTEMPTS,
} from "@/lib/storage";
import { DAILY_LIMIT, isOverDailyLimit } from "@/lib/rateLimit";
import { resolveGroqModel } from "@/lib/transcribe/model";
import { resolveTranscribeMode, resolveTranslationLanguage, translationLanguageLabel } from "@/lib/translate/languages";
import { translateText } from "@/lib/translate/groq";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Transcribe un audio con Groq y guarda el resultado. Requiere sesión.
 * La clave de Groq vive SOLO en el servidor (GROQ_API_KEY).
 */
export async function POST(req: NextRequest) {
  // 1) Sesión obligatoria (cookies web o Bearer del cliente desktop).
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "El servicio de transcripción no está disponible en este momento." },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 400 });
  }

  const file = form.get("file");
  const language = (form.get("language") as string) || "es";
  // El modelo lo elige el cliente, pero SIEMPRE se valida contra una allowlist estricta
  // antes de mandarlo a Groq (ver src/lib/transcribe/model.ts) — nunca se reenvía tal cual.
  const model = resolveGroqModel(form.get("model"));
  // Modo "Transcribir" vs "Transcribir y traducir" (Fase F4, ver ROADMAP.md item 6) + idioma
  // destino — ambos validados contra allowlists estrictas (ver src/lib/translate/languages.ts),
  // mismo criterio que `model`/`language` acá arriba.
  const mode = resolveTranscribeMode(form.get("mode"));
  const targetLanguage = resolveTranslationLanguage(form.get("targetLanguage"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ningún audio." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "El audio supera los 25 MB." }, { status: 413 });
  }

  const audioName = file.name || "audio";

  // 1.4) Límite diario de transcripciones por usuario.
  //      Se cuentan también las transcripciones soft-deleted: el usuario ya consumió cuota
  //      real de Groq al crearlas, sin importar si luego las movió a la papelera.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneDayAgo);

  if (isOverDailyLimit(dailyCount ?? 0, DAILY_LIMIT)) {
    return NextResponse.json(
      { error: "Llegaste al límite diario de transcripciones. Probá mañana o escribinos." },
      { status: 429 }
    );
  }

  // 1.5) Dedupe: si ya existe una transcripción con el mismo nombre y tamaño para este
  //      usuario, no volvemos a llamar a Groq ni a duplicar. Devolvemos la existente.
  //      Esto también neutraliza el doble-submit (dos requests casi simultáneas).
  //
  //      Fase F4: el dedupe TIENE EN CUENTA el modo. Si el usuario pide "Transcribir y traducir" a
  //      un idioma que la copia existente NO tiene (`translated_to` distinto del pedido), NO
  //      cortamos acá — dejamos que el request siga y produzca la versión traducida (un artefacto
  //      genuinamente distinto, no un duplicado). Sin esto, pedir traducir un archivo ya transcrito
  //      devolvía la versión vieja SIN traducir informando éxito total (ni warning ni badge): el
  //      feature que el usuario pidió simplemente no ocurría, en silencio.
  //
  //      `translated_to` puede no existir todavía en el esquema del preview (migración F4 sin
  //      aplicar) — ante un 42703 reintentamos sin esa columna y asumimos "no traducida" (`null`),
  //      mismo patrón de compat que el insert/select de más abajo.
  let existing: { id: string; text: string | null; translated_to: string | null } | null = null;
  {
    const withTranslated = await supabase
      .from("transcriptions")
      .select("id, text, translated_to")
      .eq("user_id", user.id)
      .eq("audio_name", audioName)
      .eq("audio_size", file.size)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (withTranslated.error && isMissingColumnError(withTranslated.error)) {
      const reduced = await supabase
        .from("transcriptions")
        .select("id, text")
        .eq("user_id", user.id)
        .eq("audio_name", audioName)
        .eq("audio_size", file.size)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = reduced.data ? { ...reduced.data, translated_to: null } : null;
    } else {
      existing = withTranslated.data ?? null;
    }
  }

  if (existing) {
    // La copia existente satisface el pedido si NO se pidió traducir, o si ya está traducida al
    // mismo idioma destino — solo en ese caso devolvemos el duplicado sin re-procesar.
    const alreadySatisfiesRequest = mode !== "translate" || existing.translated_to === targetLanguage;
    if (alreadySatisfiesRequest) {
      return NextResponse.json({ text: existing.text ?? "", duplicate: true, id: existing.id });
    }
  }

  // 2) Transcribir con Groq.
  const groqForm = new FormData();
  groqForm.append("file", file, file.name || "audio");
  groqForm.append("model", model);
  groqForm.append("response_format", "json");
  if (language && language !== "auto") groqForm.append("language", language);

  let groqResp: Response;
  try {
    groqResp = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con el servicio de transcripción. Probá de nuevo en un momento." },
      { status: 502 }
    );
  }

  // Cuota diaria agotada → mensaje amigable ("pausado para todos" hoy).
  if (groqResp.status === 429) {
    return NextResponse.json(
      { error: "El servicio está saturado por hoy (se alcanzó el límite diario). Probá más tarde." },
      { status: 429 }
    );
  }

  const raw = await groqResp.text();
  let data: { text?: string; error?: { message?: string } } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!groqResp.ok) {
    return NextResponse.json(
      { error: data?.error?.message || "No se pudo completar la transcripción. Probá de nuevo." },
      { status: groqResp.status }
    );
  }

  const text = (data.text ?? "").trim();

  // 2.5) Si se pidió "Transcribir y traducir", traducir el texto con un LLM (Groq
  //      `llama-3.1-8b-instant`, ver src/lib/translate/groq.ts). El modo "translate" nativo de
  //      Whisper SOLO traduce a inglés (research previo, ver ROADMAP.md) — por eso se traduce el
  //      TEXTO ya transcrito, no el audio, lo que permite traducir a cualquier idioma de la
  //      allowlist. Best-effort: si la traducción falla, NO se pierde el trabajo — se guarda la
  //      transcripción original igual, con un aviso para el cliente (ver `translationWarning`).
  let finalText = text;
  let translatedTo: string | null = null;
  let originalText: string | null = null;
  let translationWarning: string | undefined;

  if (mode === "translate") {
    const targetLabel = translationLanguageLabel(targetLanguage);
    // `translateText` está documentada para NUNCA lanzar (maneja red/parseo internamente), pero
    // igual la envolvemos en try/catch: todos los pasos best-effort de este handler (subida de
    // audio, insert) están protegidos así justamente para que una falla acá jamás tire abajo el
    // request y pierda la transcripción de Whisper ya pagada. Defensa en profundidad ante un futuro
    // cambio en `groq.ts` que introduzca un throw — un throw no atrapado 500-earía todo el handler
    // antes de guardar nada.
    let translationError: string | null = null;
    try {
      const translation = await translateText(text, targetLabel, apiKey);
      if (translation.ok) {
        finalText = translation.text;
        translatedTo = targetLanguage;
        originalText = text;
      } else {
        translationError = translation.error;
      }
    } catch (err) {
      translationError = err instanceof Error ? err.message : "Error inesperado al traducir.";
    }

    if (translationError) {
      translationWarning = `No se pudo traducir, pero se guardó la transcripción original: ${translationError}`;
      console.error("[transcribe] translation failed", {
        userId: user.id,
        targetLanguage,
        error: translationError,
      });
      Sentry.captureException(new Error(translationError), {
        extra: { userId: user.id, stage: "translate", targetLanguage },
      });
    }
  }

  // 3) Subir el audio a Storage (bucket privado, carpeta del usuario). Best-effort:
  //    si falla la subida, igual guardamos el texto (sin audio).
  let audioPath: string | null = null;
  try {
    const ext = audioExtension(audioName);
    const path = buildAudioObjectPath(user.id, randomUUID(), ext);
    // Reintenta ante fallas transitorias (red, timeouts) con backoff: 3 intentos totales.
    // Mismo path en cada intento — es seguro porque `upsert: false` y el intento previo
    // falló, así que el objeto nunca llegó a crearse.
    const { error: upErr, attempts } = await uploadWithRetry(() =>
      supabase.storage.from(AUDIO_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })
    );
    if (!upErr) {
      audioPath = path;
    } else {
      // Best-effort: no bloqueamos la respuesta, pero esto NO puede desaparecer en
      // silencio — sin este log era imposible saber por qué un audio se perdía
      // (bucket inexistente, RLS, etc.) sin entrar al dashboard de Supabase.
      console.error("[transcribe] audio upload failed", {
        path,
        userId: user.id,
        error: upErr.message,
        name: upErr.name,
        attempts,
      });
      Sentry.captureException(upErr, {
        extra: { path, userId: user.id, stage: "audio-upload", attempts },
      });
    }
  } catch (err) {
    // Llegar acá significa que `uploadWithRetry` agotó los UPLOAD_MAX_ATTEMPTS intentos y el
    // último también lanzó una excepción (no un `error` devuelto por el SDK).
    console.error("[transcribe] audio upload threw", err, { attempts: UPLOAD_MAX_ATTEMPTS });
    Sentry.captureException(err, {
      extra: { userId: user.id, stage: "audio-upload", attempts: UPLOAD_MAX_ATTEMPTS },
    });
  }

  // 4) Guardar la transcripción. Acepta un proyecto destino y un título opcionales (el título lo
  //    manda, por ejemplo, el modal de "Guardar grabación" en TranscribeWorkspace; si no viene,
  //    la transcripción queda sin título propio, igual que hoy — la UI usa `audio_name` como
  //    fallback visual hasta que el usuario lo edite desde el detalle).
  const projectId = (form.get("projectId") as string) || null;
  const titleRaw = (form.get("title") as string) || "";
  // Columna `title` es NOT NULL DEFAULT '' (ver migración transcription_title): si no viene
  // título, guardamos "" (no null) — la UI ya usa `audio_name` como fallback visual cuando
  // `title` está vacío (ver placeholder en TranscriptionDetail).
  const title = titleRaw.trim().slice(0, 120);
  let savedId: string | null = null;
  try {
    const baseRow = {
      user_id: user.id,
      project_id: projectId,
      title,
      audio_name: audioName,
      audio_size: file.size,
      audio_url: audioPath, // path del objeto; la URL firmada se genera al leer.
      text: finalText,
      language,
      model,
    };
    // `translated_to`/`original_text` (Fase F4, ver supabase/migrations/20260709210000_translation.sql)
    // se aplican automático recién al mergear a `main` (mismo criterio que `projects.color` en F2) —
    // en el preview de esta branch pueden no existir todavía. Se intenta con las columnas nuevas
    // primero y, ante un 42703 (columna inexistente), se reintenta sin ellas: la traducción SIGUE
    // llegando al usuario en la respuesta de este request (`finalText`/`translationWarning`), solo
    // no queda etiquetada en la fila hasta que la migración esté aplicada. A diferencia de
    // `projects.color` en F2 (que usa el cache compartido de `schema-compat.ts` con TTL porque tiene
    // muchos call-sites), acá se detecta por intento directo sin cache: la ventana de "migración sin
    // aplicar" es corta y de bajo tráfico. OJO: hay OTRO retry de compat en el read-path del detalle
    // (`app/t/[id]/page.tsx`) y en el dedupe de más arriba — todos independientes y sin cache a
    // propósito; si esto se volviera caliente, valdría unificarlos en un cache compartido como F2.
    let insertResult = await supabase
      .from("transcriptions")
      .insert({ ...baseRow, translated_to: translatedTo, original_text: originalText })
      .select("id")
      .single();

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabase.from("transcriptions").insert(baseRow).select("id").single();
    }

    const { data: inserted, error: insertErr } = insertResult;
    if (insertErr) {
      console.error("[transcribe] transcription insert failed", {
        userId: user.id,
        error: insertErr.message,
      });
      Sentry.captureException(insertErr, {
        extra: { userId: user.id, stage: "transcription-insert" },
      });
    }
    savedId = inserted?.id ?? null;
  } catch (err) {
    // No bloqueamos la respuesta por un error de guardado, pero lo dejamos visible.
    console.error("[transcribe] transcription insert threw", err);
    Sentry.captureException(err, { extra: { userId: user.id, stage: "transcription-insert" } });
  }

  return NextResponse.json({
    text: finalText,
    id: savedId,
    audioStored: audioPath !== null,
    ...(translationWarning ? { translationWarning } : {}),
  });
}
