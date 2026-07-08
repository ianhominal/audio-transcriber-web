export const AUDIO_BUCKET = "audios";

/** Extensión de un nombre de archivo, en minúsculas y con punto ("" si no tiene). */
export function audioExtension(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename ?? "");
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * Path del objeto en Storage: {userId}/{objectId}{ext}.
 * El primer segmento es el userId para que la RLS aísle por carpeta.
 */
export function buildAudioObjectPath(userId: string, objectId: string, ext: string): string {
  return `${userId}/${objectId}${ext}`;
}

/**
 * Backoff entre reintentos de subida a Storage, en ms: 300ms tras el 1er intento fallido,
 * 800ms tras el 2do. Junto con el intento original da 3 intentos totales.
 */
export const UPLOAD_RETRY_DELAYS_MS = [300, 800];

/** Cantidad total de intentos que hace `uploadWithRetry` con el backoff por defecto (1 + reintentos). */
export const UPLOAD_MAX_ATTEMPTS = UPLOAD_RETRY_DELAYS_MS.length + 1;

/**
 * Reintenta una subida a Storage con backoff ante fallas transitorias (red, timeouts, etc.).
 * `attempt` es la llamada real, ej. `() => supabase.storage.from(bucket).upload(path, file, opts)`.
 * Se reintenta con el MISMO path tanto si la llamada devuelve `{ error }` como si lanza una
 * excepción: como el intento previo falló, el objeto no llegó a crearse en Storage, así que
 * reintentar con `upsert: false` sigue siendo seguro (no pisa un objeto ajeno).
 *
 * En el último intento, si `attempt` devuelve un resultado con `error`, se devuelve ese resultado
 * tal cual (no se lanza) — el caller decide cómo loguearlo, igual que si nunca hubiera habido
 * reintentos. Si en cambio `attempt` LANZA en el último intento, la excepción se repropaga tal
 * cual para que el caller la maneje con su propio try/catch (mismo comportamiento que sin retry).
 */
export async function uploadWithRetry<T extends { error: unknown }>(
  attempt: () => Promise<T>,
  delaysMs: number[] = UPLOAD_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T & { attempts: number }> {
  const totalAttempts = delaysMs.length + 1;
  for (let i = 0; i < totalAttempts; i++) {
    const isLast = i === totalAttempts - 1;
    try {
      const result = await attempt();
      if (!result.error || isLast) {
        return { ...result, attempts: i + 1 };
      }
    } catch (err) {
      if (isLast) throw err;
    }
    await sleep(delaysMs[i]);
  }
  // Inalcanzable: el último intento del loop siempre devuelve o lanza. Solo está acá para que
  // TypeScript vea un `return`/`throw` en todos los caminos.
  throw new Error("uploadWithRetry: unreachable");
}
