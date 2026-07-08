"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { validateProjectName } from "@/lib/format";
import { collectProjectSubtreeIds, type ProjectParentLink } from "@/lib/drive/tree";
import {
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markSchemaCompatResult,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";

/**
 * Columnas de Drive-sync v2 en `projects` (ver `src/lib/supabase/schema-compat.ts`): si
 * `parent_project_id` todavía no existe en producción, no hay subárbol que calcular — el
 * borrado sigue funcionando, acotado al propio proyecto (comportamiento previo a Drive-sync v2)
 * en vez de fallar por completo como pasaba antes (la query fallaba y `deleteProject` devolvía
 * error sin borrar nada).
 */
async function fetchActiveProjectParentLinksCompat(
  supabase: SupabaseClient
): Promise<{ links: ProjectParentLink[]; error: { message: string } | null }> {
  const now = Date.now();
  const runQuery = (columns: string) => supabase.from("projects").select(columns).is("deleted_at", null);

  const cached = getSchemaCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectSchemaCompat(now);

  if (useReducedDirectly) {
    const { data, error } = await runQuery("id");
    return {
      links: ((data ?? []) as unknown as { id: string }[]).map((p) => ({ id: p.id, parentProjectId: null })),
      error,
    };
  }

  const { data, error } = await runQuery("id, parent_project_id");
  if (!error) {
    markSchemaCompatResult(true, now);
    const links = ((data ?? []) as unknown as { id: string; parent_project_id: string | null }[]).map((p) => ({
      id: p.id,
      parentProjectId: p.parent_project_id,
    }));
    return { links, error: null };
  }

  if (isMissingColumnError(error)) {
    markSchemaCompatResult(false, now);
    const retry = await runQuery("id");
    return {
      links: ((retry.data ?? []) as unknown as { id: string }[]).map((p) => ({ id: p.id, parentProjectId: null })),
      error: retry.error,
    };
  }

  return { links: [], error };
}

/** Devuelve el usuario autenticado o corta con redirect a /login. */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export type ActionResult = { ok: boolean; error?: string };
export type CreateProjectResult = { ok: true; id: string } | { ok: false; error: string };

// ---------------- Proyectos ----------------

export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  const parsed = validateProjectName(String(formData.get("name") ?? ""));
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { supabase, user } = await requireUser();
  const icon = String(formData.get("icon") ?? "").slice(0, 8);
  const description = String(formData.get("description") ?? "").slice(0, 2000);

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.value,
      title: parsed.value,
      icon,
      description,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo crear el proyecto." };

  revalidatePath("/app");
  return { ok: true, id: data.id };
}

/**
 * Crea una SUBcarpeta (proyecto con `parent_project_id`) dentro del explorador jerárquico (doc
 * 10 + explorador). Reusa `validateProjectName` (misma regla que un proyecto raíz). Si la
 * migración `20260707130000_drive_sync_v2_foundation.sql` todavía no está aplicada en producción
 * (columna `parent_project_id` inexistente), degrada con un mensaje claro en vez de romper — el
 * insert simplemente falla con `42703` y lo traducimos a un error entendible por el usuario (ver
 * `isMissingColumnError` en `schema-compat.ts`).
 */
export async function createSubproject(
  parentId: string,
  name: string,
  description?: string,
  icon?: string
): Promise<CreateProjectResult> {
  const parsed = validateProjectName(name);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.value,
      title: parsed.value,
      icon: (icon ?? "📁").slice(0, 8),
      description: (description ?? "").slice(0, 2000),
      parent_project_id: parentId,
      sync_origin: "local",
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingColumnError(error)) {
      return {
        ok: false,
        error: "Las subcarpetas todavía no están disponibles: falta aplicar una actualización pendiente de la base de datos.",
      };
    }
    return { ok: false, error: "No se pudo crear la subcarpeta." };
  }
  if (!data) return { ok: false, error: "No se pudo crear la subcarpeta." };

  revalidatePath("/app");
  return { ok: true, id: data.id };
}

/** Guarda el contexto/descripción del proyecto (columna `description`, existe desde el esquema inicial). */
export async function updateProjectDescription(id: string, description: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("projects")
    .update({ description: description.slice(0, 2000), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar el contexto." };

  revalidatePath("/app");
  return { ok: true };
}

export async function renameProject(
  id: string,
  name: string,
  icon?: string
): Promise<ActionResult> {
  const parsed = validateProjectName(name);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { supabase } = await requireUser();
  const update: Record<string, string> = {
    name: parsed.value,
    title: parsed.value,
    updated_at: new Date().toISOString(),
  };
  if (icon !== undefined) update.icon = icon.slice(0, 8);

  const { error } = await supabase.from("projects").update(update).eq("id", id);
  if (error) return { ok: false, error: "No se pudo renombrar el proyecto." };

  revalidatePath("/app");
  return { ok: true };
}

export async function duplicateProject(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { data: orig } = await supabase
    .from("projects")
    .select("name, icon, description")
    .eq("id", id)
    .single();
  if (!orig) return { ok: false, error: "No se encontró el proyecto." };

  // Duplica la carpeta (no las transcripciones que contiene).
  const { error } = await supabase.from("projects").insert({
    user_id: user.id,
    name: `Copia de ${orig.name}`,
    title: `Copia de ${orig.name}`,
    icon: orig.icon ?? "",
    description: orig.description ?? "",
  });
  if (error) return { ok: false, error: "No se pudo duplicar el proyecto." };

  revalidatePath("/app");
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  // Papelera (soft delete) en CASCADA: se propaga a todo el subárbol (hijos, nietos, ...) y a
  // las transcripciones de cada uno de esos proyectos, de forma consistente — ya no quedan
  // subproyectos huérfanos promovidos a raíz. Misma lógica pura que usa /api/sync/push
  // (`collectProjectSubtreeIds` en src/lib/drive/tree.ts) para que web y desktop se comporten igual.
  const { links: activeLinks, error: fetchError } = await fetchActiveProjectParentLinksCompat(supabase);
  if (fetchError) return { ok: false, error: "No se pudo borrar el proyecto." };

  const subtreeIds = Array.from(collectProjectSubtreeIds(id, activeLinks));

  const now = new Date().toISOString();
  const { error: transcriptionsError } = await supabase
    .from("transcriptions")
    .update({ deleted_at: now })
    .in("project_id", subtreeIds);
  if (transcriptionsError) return { ok: false, error: "No se pudo borrar el proyecto." };

  const { error } = await supabase.from("projects").update({ deleted_at: now }).in("id", subtreeIds);
  if (error) return { ok: false, error: "No se pudo borrar el proyecto." };

  revalidatePath("/app");
  return { ok: true };
}

// ---------------- Transcripciones ----------------

export async function updateTranscriptionText(id: string, text: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("transcriptions").update({ text }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar el texto." };

  revalidatePath(`/app/t/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function updateTranscriptionTitle(id: string, title: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transcriptions")
    .update({ title: title.trim().slice(0, 120) })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar el título." };

  revalidatePath(`/app/t/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

/** Guarda título, texto, descripción e ícono juntos (el botón "Guardar" del detalle). */
export async function updateTranscription(
  id: string,
  fields: { title: string; text: string; description: string; icon: string }
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transcriptions")
    .update({
      title: fields.title.trim().slice(0, 120),
      text: fields.text,
      description: fields.description.slice(0, 2000),
      icon: fields.icon.slice(0, 8),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar." };

  revalidatePath(`/app/t/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function assignTranscriptionToProject(
  id: string,
  projectId: string | null
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transcriptions")
    .update({ project_id: projectId })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo mover la transcripción." };

  revalidatePath(`/app/t/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function deleteTranscription(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  // Papelera (soft delete): el audio en Storage se conserva por si hay que recuperar.
  // La purga definitiva (Storage incluido) la hará un job a los ~30 días.
  const { error } = await supabase
    .from("transcriptions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudo borrar la transcripción." };

  revalidatePath("/app");
  return { ok: true };
}
