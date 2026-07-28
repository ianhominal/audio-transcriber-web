import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/schema-compat";
import { computeShareReadiness, type ShareReadinessRow } from "@/lib/shareReadiness/compute";

export const runtime = "nodejs";

/**
 * `GET /api/projects/[id]/share-readiness` — Team Sharing slice 1b, Phase 10 (design ADR-14 §1,
 * spec "Detección de audio faltante al compartir"). Capability `read` — lecture-only, RLS is the
 * single source of truth (I-8), no explicit capability re-check here.
 *
 * Two-step subtree resolution instead of a single joined query (`transcriptions` `!inner`
 * `projects`): a hand-rolled PostgREST embed depends on a specific FK relationship name that
 * can't be exercised against a real database in this pass (hard rule: nothing runs against
 * Supabase here), so the safer, easier-to-reason-about shape is two plain queries. Degrades
 * gracefully when Phase 1 (`root_project_id`) is not applied yet: falls back to treating the
 * requested project as its own subtree (no hierarchy awareness, but never a 500).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const projectResult = await supabase
    .from("projects")
    .select("id, root_project_id")
    .eq("id", projectId)
    .maybeSingle();

  let subtreeProjectIds: string[];

  if (projectResult.error) {
    if (!isMissingColumnError(projectResult.error)) {
      return NextResponse.json({ error: "No se pudo leer el proyecto." }, { status: 500 });
    }
    // Degraded: `root_project_id` not applied yet — no subtree awareness.
    subtreeProjectIds = [projectId];
  } else if (!projectResult.data) {
    // RLS hides rows the caller can't read the same way as "not found" — uniform, no hint.
    return NextResponse.json({ error: "Proyecto no encontrado." }, { status: 404 });
  } else {
    const root = (projectResult.data as { id: string; root_project_id: string | null }).root_project_id ?? projectId;
    const subtreeResult = await supabase.from("projects").select("id").eq("root_project_id", root);
    subtreeProjectIds =
      subtreeResult.error || !subtreeResult.data?.length
        ? [projectId]
        : (subtreeResult.data as Array<{ id: string }>).map((p) => p.id);
  }

  const rowsResult = await supabase
    .from("transcriptions")
    .select("id, audio_name, project_id, audio_url, deleted_at")
    .in("project_id", subtreeProjectIds)
    .is("deleted_at", null)
    .is("audio_url", null);

  if (rowsResult.error) {
    if (isMissingTableError(rowsResult.error)) {
      return NextResponse.json({ missingAudioCount: 0, items: [] });
    }
    return NextResponse.json({ error: "No se pudo calcular el estado de los audios." }, { status: 500 });
  }

  const readiness = computeShareReadiness((rowsResult.data ?? []) as ShareReadinessRow[]);
  return NextResponse.json(readiness);
}
