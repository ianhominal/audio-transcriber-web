import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getApiUser } from "@/lib/supabase/api";
import { AUDIO_BUCKET, audioExtension, buildAudioObjectPath } from "@/lib/storage";

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
  const model = (form.get("model") as string) || "whisper-large-v3-turbo";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ningún audio." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "El audio supera los 25 MB." }, { status: 413 });
  }

  const audioName = file.name || "audio";

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
    const { error: upErr } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (!upErr) audioPath = path;
  } catch {
    /* seguir sin audio */
  }

  // 4) Guardar la transcripción. Acepta un proyecto destino opcional.
  const projectId = (form.get("projectId") as string) || null;
  let savedId: string | null = null;
  try {
    const { data: inserted } = await supabase
      .from("transcriptions")
      .insert({
        user_id: user.id,
        project_id: projectId,
        audio_name: audioName,
        audio_size: file.size,
        audio_url: audioPath, // path del objeto; la URL firmada se genera al leer.
        text,
        language,
        model,
      })
      .select("id")
      .single();
    savedId = inserted?.id ?? null;
  } catch {
    /* no bloquear la respuesta por un error de guardado */
  }

  return NextResponse.json({ text, id: savedId });
}
