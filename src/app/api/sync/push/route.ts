import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { validateProjectName } from "@/lib/format";

export const runtime = "nodejs";

/**
 * Sync push: el cliente desktop envía cambios de metadata.
 * - Proyectos: crear/renombrar (upsert) y borrar (soft).
 * - Transcripciones: editar título/texto/proyecto y borrar (soft).
 *   La CREACIÓN de transcripciones (con audio) va por /api/transcribe, no acá.
 *
 * El cliente es autoritativo sobre los IDs: genera UUIDs para los proyectos nuevos
 * y los manda como `id`, así la correlación local↔remoto es directa.
 *
 * Body:
 * {
 *   projects?:       { upserts?: [{ id, name, icon?, description? }], deletes?: string[] },
 *   transcriptions?: { upserts?: [{ id, title?, text?, project_id? }], deletes?: string[] }
 * }
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const errors: string[] = [];

  // ---- Proyectos: upserts ----
  for (const p of body.projects?.upserts ?? []) {
    const parsed = validateProjectName(p.name ?? "");
    if (!p.id || !parsed.ok) {
      errors.push(`Proyecto inválido: ${p.id ?? "(sin id)"}`);
      continue;
    }
    const { error } = await supabase.from("projects").upsert({
      id: p.id,
      user_id: user.id,
      name: parsed.value,
      title: parsed.value,
      icon: (p.icon ?? "").slice(0, 8),
      description: p.description ?? "",
      deleted_at: null,
    });
    if (error) errors.push(`Proyecto ${p.id}: ${error.message}`);
  }

  // ---- Proyectos: deletes (soft) ----
  for (const id of body.projects?.deletes ?? []) {
    await supabase.from("transcriptions").update({ project_id: null }).eq("project_id", id).eq("user_id", user.id);
    const { error } = await supabase
      .from("projects")
      .update({ deleted_at: now })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) errors.push(`Borrar proyecto ${id}: ${error.message}`);
  }

  // ---- Transcripciones: upserts (solo metadata/texto, no creación) ----
  for (const t of body.transcriptions?.upserts ?? []) {
    if (!t.id) {
      errors.push("Transcripción sin id");
      continue;
    }
    const update: Record<string, unknown> = {};
    if (t.title !== undefined) update.title = t.title.slice(0, 120);
    if (t.text !== undefined) update.text = t.text;
    if (t.project_id !== undefined) update.project_id = t.project_id;
    if (Object.keys(update).length === 0) continue;

    const { error } = await supabase
      .from("transcriptions")
      .update(update)
      .eq("id", t.id)
      .eq("user_id", user.id);
    if (error) errors.push(`Transcripción ${t.id}: ${error.message}`);
  }

  // ---- Transcripciones: deletes (soft) ----
  for (const id of body.transcriptions?.deletes ?? []) {
    const { error } = await supabase
      .from("transcriptions")
      .update({ deleted_at: now })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) errors.push(`Borrar transcripción ${id}: ${error.message}`);
  }

  return NextResponse.json({
    serverTime: now,
    ok: errors.length === 0,
    errors,
  });
}

type PushBody = {
  projects?: {
    upserts?: { id: string; name: string; icon?: string; description?: string }[];
    deletes?: string[];
  };
  transcriptions?: {
    upserts?: { id: string; title?: string; text?: string; project_id?: string | null }[];
    deletes?: string[];
  };
};
