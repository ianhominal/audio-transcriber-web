"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { validateProjectName } from "@/lib/format";
import { sanitizeTags } from "@/lib/tags";
import { collectProjectSubtreeIds, type ProjectParentLink } from "@/lib/drive/tree";
import { resolveProjectColorId } from "@/lib/project-colors";
import {
  getProjectColorCompatSnapshot,
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markProjectColorCompatResult,
  markSchemaCompatResult,
  shouldRedetectProjectColorCompat,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";

/**
 * Corre una escritura (`insert`/`update`) de `projects` con `color`, según disponibilidad de esa
 * columna (F2, `supabase/migrations/20260709200000_project_color.sql`) — mismo patrón que
 * `fetchActiveProjectParentLinksCompat` en `/api/sync/push` para Drive-sync v2: consulta el cache
 * compartido (`schema-compat.ts`) PRIMERO en vez de intentar siempre con `color` y solo caer al
 * fallback ante un `42703`, así el camino feliz en estado estable (columna ya disponible o ya
 * confirmada ausente) paga un solo round-trip en vez de dos. `color` es puramente decorativo, así
 * que degradar en silencio es preferible a bloquear al usuario (a diferencia de
 * `parent_project_id`, que si falta cambia el comportamiento real y sí amerita un mensaje
 * explícito).
 */
async function withColorFallback<T>(
  // `PromiseLike`, no `Promise`: los query builders de Supabase (`PostgrestFilterBuilder`/
  // `PostgrestBuilder`) son "thenables" (implementan `.then()`) pero no `Promise` reales (no
  // tienen `.catch()`/`.finally()`), que es justo lo que se le pasa acá sin resolver todavía.
  run: (includeColor: boolean) => PromiseLike<{ data: T | null; error: unknown }>
): Promise<{ data: T | null; error: unknown }> {
  const now = Date.now();
  const cached = getProjectColorCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectProjectColorCompat(now);

  if (useReducedDirectly) return run(false);

  const attempt = await run(true);
  if (!attempt.error) {
    markProjectColorCompatResult(true, now);
    return attempt;
  }

  if (isMissingColumnError(attempt.error)) {
    markProjectColorCompatResult(false, now);
    return run(false);
  }

  return attempt;
}

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
  const color = resolveProjectColorId(formData.get("color"));

  const { data, error } = await withColorFallback<{ id: string }>((includeColor) =>
    supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: parsed.value,
        title: parsed.value,
        icon,
        description,
        ...(includeColor ? { color } : {}),
      })
      .select("id")
      .single()
  );
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
  icon?: string,
  color?: string | null
): Promise<CreateProjectResult> {
  const parsed = validateProjectName(name);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { supabase, user } = await requireUser();
  const resolvedColor = resolveProjectColorId(color);

  const { data, error } = await withColorFallback<{ id: string }>((includeColor) =>
    supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: parsed.value,
        title: parsed.value,
        icon: (icon ?? "📁").slice(0, 8),
        description: (description ?? "").slice(0, 2000),
        parent_project_id: parentId,
        sync_origin: "local",
        ...(includeColor ? { color: resolvedColor } : {}),
      })
      .select("id")
      .single()
  );

  if (error) {
    if (isMissingColumnError(error)) {
      return {
        ok: false,
        error: "Las subcarpetas todavía no están disponibles para tu cuenta. Probá de nuevo más tarde.",
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

/**
 * `icon`/`color` son OPTIONAL en el sentido de `buildProjectRow` (ver `schema-compat.ts`):
 * `undefined` = no tocar ese campo, cualquier otro valor (incluido `null` para `color` = "sin
 * color"/neutro) = pisarlo. `color` inválido se sanea a `null` vía `resolveProjectColorId` en vez
 * de dejar pasar un string arbitrario al `update` (defensa en profundidad además del `CHECK` de
 * la migración).
 */
export async function renameProject(
  id: string,
  name: string,
  icon?: string,
  color?: string | null
): Promise<ActionResult> {
  const parsed = validateProjectName(name);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { supabase } = await requireUser();
  const baseUpdate: Record<string, string | null> = {
    name: parsed.value,
    title: parsed.value,
    updated_at: new Date().toISOString(),
  };
  if (icon !== undefined) baseUpdate.icon = icon.slice(0, 8);
  const resolvedColor = color !== undefined ? resolveProjectColorId(color) : undefined;

  const { error } = await withColorFallback((includeColor) =>
    supabase
      .from("projects")
      .update(resolvedColor !== undefined && includeColor ? { ...baseUpdate, color: resolvedColor } : baseUpdate)
      .eq("id", id)
  );
  if (error) return { ok: false, error: "No se pudo renombrar el proyecto." };

  revalidatePath("/app");
  return { ok: true };
}

export async function duplicateProject(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  // Lectura con el mismo cache de compat que la escritura (`withColorFallback` arriba): consulta
  // el cache PRIMERO en vez de intentar siempre con `color` y caer al fallback recién ante un
  // `42703` — mismo criterio de un solo round-trip en estado estable.
  const now = Date.now();
  const colorCached = getProjectColorCompatSnapshot();
  const colorKnownUnavailable = colorCached.available === false && !shouldRedetectProjectColorCompat(now);

  type OrigRow = { name: string; icon: string; description: string; color: string | null };
  let orig: OrigRow | null = null;

  if (colorKnownUnavailable) {
    const reduced = await supabase.from("projects").select("name, icon, description").eq("id", id).single();
    if (reduced.data) orig = { ...reduced.data, color: null };
  } else {
    const full = await supabase.from("projects").select("name, icon, description, color").eq("id", id).single();
    if (!full.error && full.data) {
      markProjectColorCompatResult(true, now);
      orig = full.data as OrigRow;
    } else if (full.error && isMissingColumnError(full.error)) {
      markProjectColorCompatResult(false, now);
      const reduced = await supabase.from("projects").select("name, icon, description").eq("id", id).single();
      if (reduced.data) orig = { ...reduced.data, color: null };
    }
  }
  if (!orig) return { ok: false, error: "No se encontró el proyecto." };
  const original = orig;

  // Duplica la carpeta (no las transcripciones que contiene).
  const { error } = await withColorFallback((includeColor) =>
    supabase.from("projects").insert({
      user_id: user.id,
      name: `Copia de ${original.name}`,
      title: `Copia de ${original.name}`,
      icon: original.icon ?? "",
      description: original.description ?? "",
      ...(includeColor ? { color: original.color } : {}),
    })
  );
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

/**
 * Reemplaza la lista completa de tags de una transcripción (tanda 3 de quick wins, ver ROADMAP.md).
 * Hoy usado solo para QUITAR un tag desde el detalle (chip "×", ver `removeTag` en
 * `transcription-detail.tsx`) con guardado inmediato — no pasa por el flujo `dirty`/"Guardar" de
 * título/texto/descripción/ícono. Deliberadamente genérica (recibe el array completo, no un solo
 * tag a agregar/quitar): deja el modelo listo para un alta manual de tags a futuro sin tocar el
 * backend (ver ROADMAP.md), aunque esta tanda no construye esa UI. Sanea con `sanitizeTags` (mismo
 * criterio que la generación automática: minúscula, dedupe, cap) — defensa en profundidad más allá
 * de lo que ya valida el cliente.
 */
export async function updateTranscriptionTags(id: string, tags: string[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transcriptions")
    .update({ tags: sanitizeTags(tags) })
    .eq("id", id);
  if (error) return { ok: false, error: "No se pudieron actualizar las etiquetas." };

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
