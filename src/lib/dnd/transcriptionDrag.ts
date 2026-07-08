/**
 * Lógica pura del drag & drop de transcripciones entre proyectos (fila de la lista → proyecto
 * del sidebar). Separada de los componentes para poder testearla sin DOM real: los componentes
 * ("use client") solo arman/leen el `dataTransfer` y llaman a estas funciones.
 */

/** MIME custom del payload de drag & drop (evita interferir con drags nativos, ej. archivos). */
export const TRANSCRIPTION_DRAG_MIME = "application/x-transcription-drag";

export type TranscriptionDragPayload = {
  id: string;
  /** `project_id` de la transcripción al momento de iniciar el arrastre. */
  projectId: string | null;
};

/** Serializa el payload para `dataTransfer.setData`. */
export function encodeTranscriptionDragPayload(payload: TranscriptionDragPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parsea el payload leído de `dataTransfer.getData`. Nunca lanza: un drag externo (ej. el
 * usuario arrastra un archivo o texto desde otra app/pestaña) puede llegar acá con contenido
 * arbitrario o vacío, y debe ignorarse en silencio en vez de romper el drop.
 */
export function decodeTranscriptionDragPayload(raw: string): TranscriptionDragPayload | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { id, projectId } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  if (projectId !== null && typeof projectId !== "string") return null;
  return { id, projectId };
}

export type DropResolution =
  | { shouldMove: true; id: string; projectId: string | null }
  | { shouldMove: false; reason: "same-project" | "invalid-target" };

/**
 * Resuelve si soltar una transcripción sobre un proyecto destino ("Sin proyecto" = `null`) debe
 * disparar el update. Reglas:
 * - No-op si ya está en ese proyecto (evita una llamada a la server action innecesaria).
 * - `targetProjectId` no nulo debe estar en `knownProjectIds` (defensa en profundidad: el
 *   `dataTransfer` lo controla el navegador/DOM, nunca hay que confiar ciegamente en su
 *   contenido aunque la UI ya limite a proyectos reales del usuario).
 */
export function resolveTranscriptionDrop(
  payload: TranscriptionDragPayload,
  targetProjectId: string | null,
  knownProjectIds: readonly string[]
): DropResolution {
  if (targetProjectId !== null && !knownProjectIds.includes(targetProjectId)) {
    return { shouldMove: false, reason: "invalid-target" };
  }
  if (targetProjectId === payload.projectId) {
    return { shouldMove: false, reason: "same-project" };
  }
  return { shouldMove: true, id: payload.id, projectId: targetProjectId };
}
