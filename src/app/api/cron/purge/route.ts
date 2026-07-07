import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { AUDIO_BUCKET } from "@/lib/storage";
import { cutoffDateIso } from "@/lib/purge";

export const runtime = "nodejs";

const RETENTION_DAYS = 30;

/**
 * Compara dos strings en tiempo constante (evita timing attacks sobre CRON_SECRET).
 * Si las longitudes difieren, igual corre una comparación (contra sí mismo) para no
 * filtrar esa diferencia por el tiempo de respuesta, y devuelve `false` sin lanzar excepción.
 */
function safeCompare(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);

  if (candidateBuf.length !== expectedBuf.length) {
    timingSafeEqual(candidateBuf, candidateBuf);
    return false;
  }

  return timingSafeEqual(candidateBuf, expectedBuf);
}

/**
 * Cron de purga de papelera: borra en duro (no soft) proyectos y transcripciones
 * con `deleted_at` más viejo que RETENTION_DAYS, y limpia el audio en Storage.
 *
 * Protegido por secreto (Vercel Cron manda el header; el query param es para pruebas manuales).
 *
 * Este endpoint corre "como sistema", sin usuario logueado (no hay cookies ni Bearer de un
 * usuario), así que usa `createServiceRoleClient` (bypassea RLS a propósito) en vez del cliente
 * normal por cookies. Como el service role ignora las policies de RLS, el filtro
 * `deleted_at < cutoff` es lo único que acota el blast radius: cualquier error ahí afectaría
 * filas de TODOS los usuarios, no solo del que dispara el request. `cutoffDateIso` (en
 * `src/lib/purge.ts`) tiene tests dedicados para ese cálculo.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secretFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const secretFromQuery = req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  const isAuthorized =
    !!expected &&
    ((!!secretFromHeader && safeCompare(secretFromHeader, expected)) ||
      (!!secretFromQuery && safeCompare(secretFromQuery, expected)));

  if (!isAuthorized) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = cutoffDateIso(RETENTION_DAYS);

  // ---- Transcripciones vencidas: primero leemos el audio_url para limpiar Storage ----
  const { data: expiredTranscriptions } = await supabase
    .from("transcriptions")
    .select("id, audio_url")
    .lt("deleted_at", cutoff);

  let deletedAudioFiles = 0;
  const audioPaths = (expiredTranscriptions ?? [])
    .map((t) => t.audio_url)
    .filter((path): path is string => Boolean(path));

  if (audioPaths.length > 0) {
    const { error: storageErr } = await supabase.storage.from(AUDIO_BUCKET).remove(audioPaths);
    if (!storageErr) {
      deletedAudioFiles = audioPaths.length;
    } else {
      console.error("[cron/purge] error borrando audios en Storage:", storageErr.message);
    }
  }

  const { count: deletedTranscriptions } = await supabase
    .from("transcriptions")
    .delete({ count: "exact" })
    .lt("deleted_at", cutoff);

  // ---- Proyectos vencidos ----
  const { count: deletedProjects } = await supabase
    .from("projects")
    .delete({ count: "exact" })
    .lt("deleted_at", cutoff);

  return NextResponse.json({
    deletedProjects: deletedProjects ?? 0,
    deletedTranscriptions: deletedTranscriptions ?? 0,
    deletedAudioFiles,
  });
}
