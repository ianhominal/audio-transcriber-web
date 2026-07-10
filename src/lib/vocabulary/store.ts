import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import type { VocabularyTerm } from "./types";
import { MAX_VOCABULARY_TERMS } from "./validate";

type VocabularyTermRow = { id: string; term: string; created_at: string };

function rowToTerm(row: VocabularyTermRow): VocabularyTerm {
  return { id: row.id, term: row.term, createdAt: row.created_at };
}

export type MutateVocabularyResult =
  | { ok: true; term: VocabularyTerm }
  | { ok: false; error: string; code?: "duplicate" | "limit" };

/** true si el error de Postgres es una violación de unicidad (término ya existe para ese usuario). */
function isDuplicateTermError(error: { code?: unknown } | null): boolean {
  return !!error && typeof error.code === "string" && error.code === "23505";
}

/**
 * true si el error viene del trigger `enforce_vocabulary_term_limit` de la DB (el usuario ya tiene
 * el máximo de términos, ver migración `20260710120000_user_vocabulary.sql`). El trigger raise-ea
 * con un token estable en el mensaje (`vocabulary_term_limit_reached`) para poder distinguirlo sin
 * depender del SQLSTATE — nunca se reenvía ese mensaje crudo al cliente, solo se detecta acá para
 * devolver el texto en español.
 */
function isTermLimitError(error: { message?: unknown } | null): boolean {
  return !!error && typeof error.message === "string" && error.message.includes("vocabulary_term_limit_reached");
}

/**
 * Lee el vocabulario custom del usuario, ordenado por antigüedad (orden de carga). Best-effort:
 * ante CUALQUIER error (tabla todavía no migrada — "relation does not exist", RLS, conexión) degrada
 * a `[]` en vez de tirar abajo la pantalla que la llama (Ajustes, o el paso de corrección en
 * `/api/transcribe`) — mismo criterio que `getUserSettings`. A propósito NO usa
 * `isMissingColumnError`: esta tabla es NUEVA (no una columna agregada a una tabla existente), así
 * que antes de que la migración se aplique el error real es "relation does not exist" (42P01), no
 * "column does not exist" (42703) — ver comentario en la migración
 * `20260710120000_user_vocabulary.sql`. El manejo de error genérico de abajo cubre ambos casos igual.
 */
export async function listVocabularyTerms(supabase: SupabaseClient, userId: string): Promise<VocabularyTerm[]> {
  const { data, error } = await supabase
    .from("vocabulary_terms")
    .select("id, term, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[vocabulary] listVocabularyTerms failed", { userId, error: error.message });
    Sentry.captureException(error, { extra: { userId, stage: "list-vocabulary-terms" } });
    return [];
  }
  return ((data as VocabularyTermRow[]) ?? []).map(rowToTerm);
}

/**
 * Agrega un término nuevo. `term` ya debe venir sanitizado (`sanitizeTerm`, ver `validate.ts`) —
 * esta función solo hace el INSERT. El cap de cantidad (`MAX_VOCABULARY_TERMS`) lo garantiza de
 * forma ATÓMICA un trigger BEFORE INSERT en la DB (ver migración), no un count-then-insert en la
 * app (que tendría una carrera TOCTOU ante inserts concurrentes). Traduce dos errores esperados de
 * Postgres a un `code` para que el caller responda 409/400 en vez de 500:
 *   - unicidad (el usuario ya tiene ese término, case-insensitive) → `code: "duplicate"`.
 *   - límite del trigger (ya tiene el máximo) → `code: "limit"`.
 * Cualquier OTRO error se loguea (server-side) y se devuelve un mensaje GENÉRICO — nunca se
 * reenvía `error.message` crudo al cliente (podría filtrar detalle interno de Postgres).
 */
export async function addVocabularyTerm(
  supabase: SupabaseClient,
  userId: string,
  term: string
): Promise<MutateVocabularyResult> {
  const { data, error } = await supabase
    .from("vocabulary_terms")
    .insert({ user_id: userId, term })
    .select("id, term, created_at")
    .single();

  if (error || !data) {
    if (isDuplicateTermError(error)) {
      return { ok: false, error: "Ese término ya está en tu vocabulario.", code: "duplicate" };
    }
    if (isTermLimitError(error)) {
      return { ok: false, error: `Llegaste al máximo de ${MAX_VOCABULARY_TERMS} términos.`, code: "limit" };
    }
    console.error("[vocabulary] addVocabularyTerm failed", { userId, error: error?.message });
    Sentry.captureException(error ?? new Error("insert sin datos"), {
      extra: { userId, stage: "add-vocabulary-term" },
    });
    return { ok: false, error: "No se pudo guardar el término." };
  }
  return { ok: true, term: rowToTerm(data as VocabularyTermRow) };
}

/** Edita el texto de un término existente, scopeado a `userId` (defensa en profundidad además de RLS). */
export async function updateVocabularyTerm(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  term: string
): Promise<MutateVocabularyResult> {
  const { data, error } = await supabase
    .from("vocabulary_terms")
    .update({ term })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, term, created_at")
    .single();

  if (error || !data) {
    if (isDuplicateTermError(error)) {
      return { ok: false, error: "Ese término ya está en tu vocabulario.", code: "duplicate" };
    }
    console.error("[vocabulary] updateVocabularyTerm failed", { userId, id, error: error?.message });
    Sentry.captureException(error ?? new Error("update sin datos"), {
      extra: { userId, id, stage: "update-vocabulary-term" },
    });
    return { ok: false, error: "No se pudo editar el término." };
  }
  return { ok: true, term: rowToTerm(data as VocabularyTermRow) };
}

/** Borra un término, scopeado a `userId` (defensa en profundidad además de RLS). */
export async function deleteVocabularyTerm(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("vocabulary_terms").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    console.error("[vocabulary] deleteVocabularyTerm failed", { userId, id, error: error.message });
    Sentry.captureException(error, { extra: { userId, id, stage: "delete-vocabulary-term" } });
    return { ok: false, error: "No se pudo borrar el término." };
  }
  return { ok: true };
}
