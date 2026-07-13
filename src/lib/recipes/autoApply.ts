import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isAiRecipeDailyLimitError } from "@/lib/aiUsage";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import { applyRecipeText, DEFAULT_RECIPE_TIMEOUT_MS } from "./apply";

export type AutoApplyDefaultRecipeResult = { output: string; recipeName: string } | null;

/**
 * Auto-aplica el Formato default del usuario (si tiene uno) al terminar de transcribir — corre
 * server-side, EN PARALELO con la subida del audio y el paso de auto-título/auto-tags (ver el
 * `Promise.all` de `/api/transcribe/route.ts`), NO streaming (junta la respuesta completa antes de
 * devolverla, vía `applyRecipeText`). Reusa el mecanismo de cap EXISTENTE (`ai_usage_log`,
 * `kind: "recipe"`, mismo trigger `enforce_ai_usage_recipe_limit` que `/api/recipes/apply` —
 * ver `20260713120000_ai_recipes.sql`), no inventa uno nuevo.
 *
 * REGLA DE ORO (best-effort ESTRICTO, mismo criterio que `generateTitleAndTags`/paso 2.7 de
 * `/api/transcribe`): NUNCA lanza. Devuelve `null` — "no hay nada para persistir" — ante CUALQUIERA
 * de estos casos, todos tratados igual por el caller (la transcripción se guarda de todos modos):
 *   - el usuario no tiene ningún formato, o ninguno marcado `is_default`;
 *   - `ai_recipes` todavía no está migrada en este entorno (tabla nueva, ventana de rollout);
 *   - está sobre su cap diario de `kind: "recipe"` (el trigger rechaza el INSERT en `ai_usage_log`);
 *   - la llamada al modelo falla, tarda de más (`DEFAULT_RECIPE_TIMEOUT_MS`), o devuelve vacío;
 *   - cualquier error inesperado de la DB.
 *
 * Ownership: la consulta a `ai_recipes` va scopeada EXPLÍCITAMENTE a `userId` (`.eq("user_id", ...)`),
 * además de la RLS ("own ai recipes", ver la migración) — defensa en profundidad, mismo criterio que
 * `/api/recipes/apply` y el resto de la app: solo el formato default DEL USUARIO QUE TRANSCRIBE puede
 * auto-aplicarse acá, nunca el de otro usuario.
 */
export async function autoApplyDefaultRecipe(
  supabase: SupabaseClient,
  userId: string,
  transcriptionText: string
): Promise<AutoApplyDefaultRecipeResult> {
  const { data: recipe, error: recipeError } = await supabase
    .from("ai_recipes")
    .select("id, name, instruction")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle<{ id: string; name: string; instruction: string }>();

  if (recipeError) {
    if (!isMissingTableError(recipeError)) {
      console.error("[transcribe] default recipe lookup failed", { userId, error: recipeError.message });
      Sentry.captureException(recipeError, { extra: { userId, stage: "auto-apply-recipe-lookup" } });
    }
    return null;
  }
  if (!recipe) return null; // sin formatos, o ninguno marcado como default

  // Cap reserve-on-attempt: mismo mecanismo atómico que `/api/recipes/apply` — se intenta el INSERT
  // en `ai_usage_log` ANTES de llamar al modelo.
  const { error: usageLogErr } = await supabase.from("ai_usage_log").insert({ user_id: userId, kind: "recipe" });

  if (usageLogErr) {
    if (isAiRecipeDailyLimitError(usageLogErr)) return null; // cap funcionando como corresponde, no es un bug
    if (!isMissingTableError(usageLogErr)) {
      console.error("[transcribe] default recipe usage log insert failed", { userId, error: usageLogErr.message });
      Sentry.captureException(usageLogErr, { extra: { userId, stage: "auto-apply-recipe-usage-log-insert" } });
      return null;
    }
    // 42P01: `ai_usage_log` todavía sin migrar — degrada sin cap (ventana de rollout), mismo criterio
    // que `/api/recipes/apply`: sigue e intenta igual la generación.
  }

  const result = await applyRecipeText(recipe.instruction, transcriptionText, DEFAULT_RECIPE_TIMEOUT_MS);
  if (!result.ok) {
    console.error("[transcribe] default recipe auto-apply failed", { userId, error: result.error });
    Sentry.captureException(new Error(result.error), { extra: { userId, stage: "auto-apply-recipe" } });
    return null;
  }

  return { output: result.text, recipeName: recipe.name };
}
