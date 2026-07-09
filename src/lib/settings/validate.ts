import { resolveGroqModel, type GroqModel } from "@/lib/transcribe/model";

/** Idiomas soportados por el selector "Idioma" (mismos valores que `transcribe-workspace.tsx`). */
export const ALLOWED_LANGUAGES = ["es", "en", "auto"] as const;
export type Language = (typeof ALLOWED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "es";

/**
 * Motores de transcripción soportados. Hoy la web SOLO transcribe con Groq (no hay selector de
 * "Motor" en la UI web, ver comentario en la migración `20260709090000_user_settings.sql`) — esta
 * allowlist de un solo valor existe para que `user_settings` tenga paridad de esquema con el
 * desktop (que sí elige entre motores) y no haya que migrar la tabla el día que la web sume la opción.
 */
export const ALLOWED_ENGINES = ["groq"] as const;
export type Engine = (typeof ALLOWED_ENGINES)[number];
export const DEFAULT_ENGINE: Engine = "groq";

/** Valida el idioma pedido contra una allowlist estricta; cualquier otro valor cae al default. */
export function resolveLanguage(input: unknown): Language {
  if (typeof input !== "string") return DEFAULT_LANGUAGE;
  const trimmed = input.trim();
  return (ALLOWED_LANGUAGES as readonly string[]).includes(trimmed)
    ? (trimmed as Language)
    : DEFAULT_LANGUAGE;
}

/** Valida el motor pedido contra una allowlist estricta; cualquier otro valor cae al default. */
export function resolveEngine(input: unknown): Engine {
  if (typeof input !== "string") return DEFAULT_ENGINE;
  const trimmed = input.trim();
  return (ALLOWED_ENGINES as readonly string[]).includes(trimmed)
    ? (trimmed as Engine)
    : DEFAULT_ENGINE;
}

/** Reexport de la validación de Calidad — misma allowlist que ya usa `/api/transcribe`. */
export function resolveQuality(input: unknown): GroqModel {
  return resolveGroqModel(input);
}
