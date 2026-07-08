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
      { error: "El servidor no tiene configurada la clave de Groq." },
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
  const { data: existing } = await supabase
    .from("transcriptions")
    .select("id, text")
    .eq("user_id", user.id)
    .eq("audio_name", audioName)
    .eq("audio_size", file.size)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ text: existing.text ?? "", duplicate: true, id: existing.id });
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
    return NextResponse.json({ error: "No se pudo contactar a Groq." }, { status: 502 });
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
      { error: data?.error?.message || `Groq devolvió ${groqResp.status}.` },
      { status: groqResp.status }
    );
  }

  const text = (data.text ?? "").trim();

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
    const { data: inserted, error: insertErr } = await supabase
      .from("transcriptions")
      .insert({
        user_id: user.id,
        project_id: projectId,
        title,
        audio_name: audioName,
        audio_size: file.size,
        audio_url: audioPath, // path del objeto; la URL firmada se genera al leer.
        text,
        language,
        model,
      })
      .select("id")
      .single();
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

  return NextResponse.json({ text, id: savedId, audioStored: audioPath !== null });
}
