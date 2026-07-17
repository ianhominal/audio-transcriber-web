import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getApiUser } from "@/lib/supabase/api";
import { AUDIO_BUCKET, buildAudioObjectPath, isAllowedAudioExtension, sanitizeAudioName } from "@/lib/storage";

export const runtime = "nodejs";

/** true si el body parseado es un objeto JSON plano (no `null`, no array, no primitivo). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prepara una subida DIRECTA a Supabase Storage, salteando el body de la función de Vercel (tope
 * duro ~4,5 MB): el cliente desktop pide acá un signed upload URL, sube el audio comprimido
 * (opus, hasta ~50 MB, ver migración `20260717120000_audio_bucket_size_limit.sql`) directo a
 * Storage con esa URL, y recién después llama a `/api/transcribe` mandando `storagePath` (en vez
 * del archivo en el body) para que el server lo transcriba desde ahí. Requiere sesión.
 *
 * Body: `{ audioName: string, ext: string }`. `audioName` es el nombre de display (no se usa para
 * el path — el path se arma con un UUID nuevo, ver `buildAudioObjectPath`); se valida acá para
 * que el desktop reciba el mismo error temprano que tendría al llamar a `/api/transcribe` después.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!isJsonObject(body)) {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const audioName = sanitizeAudioName(body.audioName);
  const ext = body.ext;
  if (!audioName || !isAllowedAudioExtension(ext)) {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const path = buildAudioObjectPath(user.id, randomUUID(), ext);

  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[audio/prepare] createSignedUploadUrl failed", {
      userId: user.id,
      path,
      error: error?.message,
    });
    return NextResponse.json({ error: "No se pudo preparar la subida. Probá de nuevo." }, { status: 500 });
  }

  // `apiKey` = la clave publishable/anon (PÚBLICA: ya viaja en el bundle del navegador). El cliente
  // desktop la necesita para el header `apikey` del PUT al signed URL — el gateway de Supabase lo
  // exige en toda ruta de `/storage/v1/`, incluso con el token firmado en la URL. Sin esto el PUT
  // da 401 "No API key found in request". Es el mismo header que manda el storage-js oficial.
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey) {
    console.error("[audio/prepare] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no configurada");
    return NextResponse.json({ error: "No se pudo preparar la subida. Probá de nuevo." }, { status: 500 });
  }

  return NextResponse.json({ path, signedUrl: data.signedUrl, apiKey });
}
