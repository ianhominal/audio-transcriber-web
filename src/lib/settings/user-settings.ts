import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { DEFAULT_ENGINE, DEFAULT_LANGUAGE } from "./validate";

/** Defaults persistentes de transcripción (Motor/Calidad/Idioma) — ver `ROADMAP.md`, ítem F1. */
export type TranscriptionDefaults = {
  engine: string;
  quality: string;
  language: string;
};

// OJO: NO reusar `DEFAULT_GROQ_MODEL` de `@/lib/transcribe/model.ts` acá — ese constante es el
// fallback de SEGURIDAD del server cuando `/api/transcribe` recibe un modelo ausente/inválido
// ("whisper-large-v3", máxima calidad), un propósito distinto al default de PRODUCTO que ya
// preseleccionaba `TranscribeWorkspace` para usuarios sin preferencia guardada ("turbo", rápido).
// Igualarlos cambiaría silenciosamente el comportamiento pre-existente para todo usuario nuevo.
export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionDefaults = {
  engine: DEFAULT_ENGINE,
  quality: "whisper-large-v3-turbo",
  language: DEFAULT_LANGUAGE,
};

type UserSettingsRow = {
  user_id: string;
  default_engine: string;
  default_quality: string;
  default_language: string;
};

function rowToDefaults(row: UserSettingsRow): TranscriptionDefaults {
  return { engine: row.default_engine, quality: row.default_quality, language: row.default_language };
}

/**
 * Lee los defaults de transcripción del usuario. Si todavía no tiene fila en `user_settings`
 * (nunca guardó un default explícito), devuelve `DEFAULT_TRANSCRIPTION_SETTINGS` sin escribir
 * nada — evita un insert de más en cada login.
 *
 * Ante un error real de Supabase (tabla inalcanzable, RLS mal configurada, etc. — no simplemente
 * "sin fila todavía") degrada al mismo default de fábrica en vez de tirar abajo la página que la
 * llama (Ajustes/Transcribir no son críticas), pero deja rastro en logs/Sentry — mismo criterio
 * que el manejo de errores best-effort de `/api/transcribe`.
 */
export async function getUserSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<TranscriptionDefaults> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id, default_engine, default_quality, default_language")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[settings] getUserSettings failed", { userId, error: error.message });
    Sentry.captureException(error, { extra: { userId, stage: "get-user-settings" } });
    return DEFAULT_TRANSCRIPTION_SETTINGS;
  }
  return data ? rowToDefaults(data as UserSettingsRow) : DEFAULT_TRANSCRIPTION_SETTINGS;
}

/**
 * Upsert ATÓMICO y parcial: solo envía las columnas presentes en `patch` (mapeadas a su nombre de
 * columna). PostgREST arma `INSERT ... ON CONFLICT (user_id) DO UPDATE SET <solo esas columnas>`
 * — si la fila no existía, las columnas ausentes toman su `DEFAULT` de la tabla; si ya existía,
 * las columnas ausentes NO se tocan. A propósito no se hace un SELECT previo para mergear en la
 * app: dos "Fijar como default" simultáneos (uno por Idioma, otro por Calidad, ver
 * `TranscribeWorkspace`) escribirían columnas distintas de la fila y un merge en la app basado en
 * un SELECT previo podía perder uno de los dos cambios por una carrera clásica read-then-write.
 */
export async function upsertUserSettings(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<TranscriptionDefaults>
): Promise<TranscriptionDefaults> {
  const row: { user_id: string; default_engine?: string; default_quality?: string; default_language?: string } = {
    user_id: userId,
  };
  if (patch.engine !== undefined) row.default_engine = patch.engine;
  if (patch.quality !== undefined) row.default_quality = patch.quality;
  if (patch.language !== undefined) row.default_language = patch.language;

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(row, { onConflict: "user_id" })
    .select("user_id, default_engine, default_quality, default_language")
    .single();

  if (error || !data) {
    console.error("[settings] upsertUserSettings failed", { userId, error: error?.message });
    Sentry.captureException(error ?? new Error("upsert sin datos"), {
      extra: { userId, stage: "upsert-user-settings" },
    });
    throw new Error(error?.message ?? "No se pudo guardar la preferencia.");
  }
  return rowToDefaults(data as UserSettingsRow);
}
