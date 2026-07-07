import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { AUDIO_BUCKET } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Sync pull: devuelve proyectos y transcripciones del usuario cambiados desde `since`
 * (timestamp ISO). Incluye los borrados (deleted_at != null) como "tombstones", para que
 * el cliente propague borrados/renombres. Sin `since` = pull completo.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const since = req.nextUrl.searchParams.get("since");
  const serverTime = new Date().toISOString();

  let projectsQuery = supabase
    .from("projects")
    .select("id, name, icon, description, created_at, updated_at, deleted_at")
    .eq("user_id", user.id);

  let transcriptionsQuery = supabase
    .from("transcriptions")
    .select(
      "id, project_id, title, audio_name, audio_size, audio_url, text, description, icon, language, model, created_at, updated_at, deleted_at"
    )
    .eq("user_id", user.id);

  if (since) {
    projectsQuery = projectsQuery.gt("updated_at", since);
    transcriptionsQuery = transcriptionsQuery.gt("updated_at", since);
  }

  const [{ data: projects, error: pErr }, { data: transcriptions, error: tErr }] = await Promise.all([
    projectsQuery,
    transcriptionsQuery,
  ]);

  if (pErr || tErr) {
    return NextResponse.json({ error: "No se pudo leer los cambios." }, { status: 500 });
  }

  // Signed URL temporal por cada audio, para que el cliente desktop pueda descargarlo
  // (el bucket es privado). Se generan en paralelo para no bloquear en serie.
  const transcriptionsWithAudio = await Promise.all(
    (transcriptions ?? []).map(async (t) => {
      if (!t.audio_url) return { ...t, audio_url_signed: null };
      const { data: signed } = await supabase.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(t.audio_url, 60 * 60);
      return { ...t, audio_url_signed: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({
    serverTime,
    projects: projects ?? [],
    transcriptions: transcriptionsWithAudio,
  });
}
