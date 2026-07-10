/** Modelos de Groq permitidos para transcripción. Cualquier otro valor cae al default. */
export const ALLOWED_GROQ_MODELS = ["whisper-large-v3", "whisper-large-v3-turbo"] as const;

export type GroqModel = (typeof ALLOWED_GROQ_MODELS)[number];

/** Modelo por defecto cuando no viene `model`, viene vacío o no está en la allowlist. */
export const DEFAULT_GROQ_MODEL: GroqModel = "whisper-large-v3";

/**
 * Valida el modelo de Groq pedido por el cliente contra una allowlist estricta.
 * NUNCA se debe pasar a Groq un valor que no haya pasado por acá: evita que el
 * cliente fuerce un modelo caro o inexistente.
 */
export function resolveGroqModel(input: unknown): GroqModel {
  if (typeof input !== "string") return DEFAULT_GROQ_MODEL;
  const trimmed = input.trim();
  if ((ALLOWED_GROQ_MODELS as readonly string[]).includes(trimmed)) {
    return trimmed as GroqModel;
  }
  return DEFAULT_GROQ_MODEL;
}

/**
 * Etiqueta legible de "Calidad" para mostrar en la UI (badge del detalle, etc.) sin exponer el
 * nombre técnico del modelo — mismo texto que ya usan los selectores de Ajustes/Transcribir.
 */
export function qualityLabel(model: string): string {
  if (model === "whisper-large-v3-turbo") return "Rápida";
  if (model === "whisper-large-v3") return "Máxima calidad";
  return "Calidad estándar";
}
