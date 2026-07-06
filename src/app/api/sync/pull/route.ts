import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";

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
      "id, project_id, title, audio_name, audio_size, audio_url, text, language, model, created_at, updated_at, deleted_at"
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

  return NextResponse.json({
    serverTime,
    projects: projects ?? [],
    transcriptions: transcriptions ?? [],
  });
}
