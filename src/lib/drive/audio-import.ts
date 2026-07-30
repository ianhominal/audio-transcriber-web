/**
 * Constantes y lógica pura de "transcribir un audio importado de Drive"
 * (ver `/api/drive/transcribe`).
 */

/**
 * Tope de tamaño que acepta Groq por archivo de audio en el tier gratuito. El límite es de GROQ, no
 * nuestro (el tier pago admite 100 MB), y está espejado en tres lugares del producto: acá, en
 * `/api/transcribe` y en `EngineSelector.CloudMaxBytes` del desktop.
 *
 * Se chequea ANTES de mandar el archivo, no después de cosechar el 413: bajar 30 MB de Drive para
 * que Groq los rechace es transferencia y tiempo tirados dentro de un `maxDuration` de 60 s.
 */
export const GROQ_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Estado de un audio importado de Drive, tal como lo muestra la lista de pendientes. */
export type DriveAudioStatus = "pending" | "working" | "done" | "error";

/**
 * Texto del progreso de una tanda ("3 de 14"). Devuelve `null` cuando no hay nada que procesar, así
 * la UI no muestra un contador vacío.
 */
export function driveBatchProgressLabel(done: number, total: number): string | null {
  if (total <= 0) return null;
  const bounded = Math.min(Math.max(done, 0), total);
  return `${bounded} de ${total}`;
}

/**
 * ¿Se puede seguir con el próximo audio de la tanda? Corta ante un error que no tiene sentido
 * reintentar con los que siguen — quedarse sin cuota diaria o perder la conexión con Drive afecta a
 * TODOS los audios, así que insistir 13 veces más solo genera 13 errores idénticos. En cambio un
 * audio puntual demasiado grande o mudo es problema de ESE archivo: se marca y se sigue.
 */
export function shouldStopBatch(errorCode: string | undefined, httpStatus: number): boolean {
  if (httpStatus === 429) return true; // límite diario: ninguno de los que siguen va a entrar
  if (httpStatus === 401 || httpStatus === 403) return true; // sesión caída
  return errorCode === "not-connected" || errorCode === "needs-reauth";
}
