import type { TranscribeMode } from "@/lib/translate/languages";

/**
 * true si la copia EXISTENTE (última fila no borrada con mismo `audio_name`/`audio_size` para este
 * usuario, ver `/api/transcribe`) satisface el pedido actual sin necesidad de volver a llamar a
 * Groq. Función PURA extraída del handler para poder testear los dos flujos de forma aislada —
 * bugfix del review adversarial 2026-07-10 (hallazgo MEDIUM #1).
 *
 * Antes del fix, la condición era `mode !== "translate" || existing.translated_to === targetLanguage`:
 * daba `true` para CUALQUIER request `mode: "transcribe"`, sin mirar si la fila existente era en
 * realidad una TRADUCCIÓN (cuyo `text` es el texto traducido, no el original). Resultado: pedir
 * "Transcribir" sobre un archivo que ya se había transcrito-y-traducido devolvía el texto TRADUCIDO
 * como si fuera la transcripción original, sin ningún aviso.
 *
 * La condición correcta es mode-aware en AMBAS direcciones:
 * - `mode === "translate"`: la copia existente sirve solo si ya está traducida al MISMO idioma
 *   destino pedido (sin cambios respecto de antes).
 * - `mode !== "translate"` (transcribir tal cual): la copia existente sirve SOLO si en sí misma NO
 *   es una traducción (`existingTranslatedTo === null`) — si la fila más reciente es una traducción,
 *   NO alcanza: hay que dejar que el request siga y produzca una transcripción fresca en el idioma
 *   original.
 */
export function dedupeSatisfiesRequest(
  mode: TranscribeMode,
  existingTranslatedTo: string | null,
  targetLanguage: string
): boolean {
  return mode === "translate" ? existingTranslatedTo === targetLanguage : existingTranslatedTo === null;
}
