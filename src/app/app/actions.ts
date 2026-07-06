"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateProjectName } from "@/lib/format";
import { AUDIO_BUCKET } from "@/lib/storage";

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

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.value,
      title: parsed.value,
      icon,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo crear el proyecto." };

  revalidatePath("/app");
  return { ok: true, id: data.id };
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
  // Las transcripciones quedan (project_id → null por la FK on delete set null).
  const { error } = await supabase.from("projects").delete().eq("id", id);
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

  // Borrar también el audio de Storage (best-effort).
  const { data: row } = await supabase
    .from("transcriptions")
    .select("audio_url")
    .eq("id", id)
    .single();
  if (row?.audio_url) {
    await supabase.storage.from(AUDIO_BUCKET).remove([row.audio_url]);
  }

  const { error } = await supabase.from("transcriptions").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo borrar la transcripción." };

  revalidatePath("/app");
  redirect("/app");
}
