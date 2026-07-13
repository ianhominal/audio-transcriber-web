import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import type { AiRecipe } from "./types";

type AiRecipeRow = {
  id: string;
  name: string;
  instruction: string;
  is_default: boolean;
  created_at: string;
};

const RECIPE_COLUMNS = "id, name, instruction, is_default, created_at";

function rowToRecipe(row: AiRecipeRow): AiRecipe {
  return { id: row.id, name: row.name, instruction: row.instruction, isDefault: row.is_default, createdAt: row.created_at };
}

export type MutateRecipeResult = { ok: true; recipe: AiRecipe } | { ok: false; error: string };

/**
 * Lee los formatos del usuario, ordenados por antigüedad (orden de carga). Best-effort: ante
 * CUALQUIER error (tabla todavía no migrada — "relation does not exist" — RLS, conexión) degrada a
 * `[]` en vez de tirar abajo la pantalla que la llama (Ajustes, o el fetch client-side del detalle) —
 * mismo criterio que `listVocabularyTerms`.
 */
export async function listRecipes(supabase: SupabaseClient, userId: string): Promise<AiRecipe[]> {
  const { data, error } = await supabase
    .from("ai_recipes")
    .select(RECIPE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[recipes] listRecipes failed", { userId, error: error.message });
      Sentry.captureException(error, { extra: { userId, stage: "list-recipes" } });
    }
    return [];
  }
  return ((data as AiRecipeRow[]) ?? []).map(rowToRecipe);
}

/**
 * Agrega un formato nuevo. `name`/`instruction` ya deben venir sanitizados (`sanitizeName`/
 * `sanitizeInstruction`, ver `validate.ts`) — esta función solo hace el INSERT. El cap de cantidad
 * (`MAX_RECIPES`) lo valida el CALLER (`canAddRecipe`, ver `/api/recipes` POST) antes de llamar acá —
 * a diferencia del vocabulario, este cap NO tiene un trigger atómico en la DB (ver migración), así
 * que hay una ventana TOCTOU teórica ante inserts concurrentes del mismo usuario; se acepta porque el
 * cap es un límite de UI (30), no una defensa de costo/abuso real.
 */
export async function createRecipe(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  instruction: string
): Promise<MutateRecipeResult> {
  const { data, error } = await supabase
    .from("ai_recipes")
    .insert({ user_id: userId, name, instruction })
    .select(RECIPE_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[recipes] createRecipe failed", { userId, error: error?.message });
    Sentry.captureException(error ?? new Error("insert sin datos"), { extra: { userId, stage: "create-recipe" } });
    return { ok: false, error: "No se pudo guardar el formato." };
  }
  return { ok: true, recipe: rowToRecipe(data as AiRecipeRow) };
}

/** Edita nombre/instrucción de un formato existente, scopeado a `userId` (defensa en profundidad
 * además de RLS). */
export async function updateRecipe(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  name: string,
  instruction: string
): Promise<MutateRecipeResult> {
  const { data, error } = await supabase
    .from("ai_recipes")
    .update({ name, instruction })
    .eq("id", id)
    .eq("user_id", userId)
    .select(RECIPE_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[recipes] updateRecipe failed", { userId, id, error: error?.message });
    Sentry.captureException(error ?? new Error("update sin datos"), { extra: { userId, id, stage: "update-recipe" } });
    return { ok: false, error: "No se pudo editar el formato." };
  }
  return { ok: true, recipe: rowToRecipe(data as AiRecipeRow) };
}

/** Borra un formato, scopeado a `userId` (defensa en profundidad además de RLS). */
export async function deleteRecipe(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("ai_recipes").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    console.error("[recipes] deleteRecipe failed", { userId, id, error: error.message });
    Sentry.captureException(error, { extra: { userId, id, stage: "delete-recipe" } });
    return { ok: false, error: "No se pudo borrar el formato." };
  }
  return { ok: true };
}

/**
 * Marca `id` como el formato default del usuario, DESMARCANDO cualquier otro que lo fuera antes.
 * Implementa el patrón de DOS UPDATE secuenciales que exige el índice único parcial
 * `ai_recipes_one_default_per_user` (ver migración `20260713120000_ai_recipes.sql`): primero se
 * desmarca cualquier fila `is_default = true` de este usuario, DESPUÉS se marca la nueva — si se
 * invirtiera el orden, el índice rechazaría el segundo UPDATE (dos `true` a la vez para el mismo
 * `user_id`).
 *
 * El primer UPDATE es un no-op silencioso si no había ningún default previo (no falla, `error` viene
 * `null` con cero filas afectadas) — no hace falta un SELECT previo para saber si existía.
 *
 * IMPORTANTE (fix de la revisión adversarial): antes de tocar nada se verifica que `id` exista y
 * pertenezca a `userId`. Sin este chequeo, un `id` inválido/borrado/ajeno hacía que el primer UPDATE
 * (desmarcar el default viejo) se confirmara igual y el segundo UPDATE fallara después — el usuario
 * perdía su formato default real sin que nada lo reemplazara. Con el chequeo previo, si el target no
 * existe no se toca el default actual.
 */
export async function setDefaultRecipe(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<MutateRecipeResult> {
  const targetCheck = await supabase.from("ai_recipes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();

  if (targetCheck.error) {
    console.error("[recipes] setDefaultRecipe target check failed", { userId, id, error: targetCheck.error.message });
    Sentry.captureException(targetCheck.error, { extra: { userId, id, stage: "set-default-recipe-check" } });
    return { ok: false, error: "No se pudo marcar el formato como el de por defecto." };
  }
  if (!targetCheck.data) {
    return { ok: false, error: "No encontramos ese formato." };
  }

  const unsetResult = await supabase
    .from("ai_recipes")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true);

  if (unsetResult.error) {
    console.error("[recipes] setDefaultRecipe unset failed", { userId, id, error: unsetResult.error.message });
    Sentry.captureException(unsetResult.error, { extra: { userId, id, stage: "set-default-recipe-unset" } });
    return { ok: false, error: "No se pudo actualizar el formato por defecto." };
  }

  const { data, error } = await supabase
    .from("ai_recipes")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select(RECIPE_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[recipes] setDefaultRecipe set failed", { userId, id, error: error?.message });
    Sentry.captureException(error ?? new Error("update sin datos"), { extra: { userId, id, stage: "set-default-recipe-set" } });
    return { ok: false, error: "No se pudo marcar el formato como el de por defecto." };
  }
  return { ok: true, recipe: rowToRecipe(data as AiRecipeRow) };
}
