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
 * Extensiones de audio conocidas aceptadas por `/api/audio/prepare` (subida directa a Storage
 * desde el desktop, salteando el body de la función de Vercel — tope duro ~4,5 MB).
 */
export const ALLOWED_AUDIO_EXTENSIONS = ["ogg", "opus", "wav", "mp3", "m4a", "webm", "aac"] as const;

/**
 * true si `ext` tiene el formato ".xxx" (un punto seguido de letras/números) Y está en la
 * allowlist de extensiones de audio conocidas. Usado por `/api/audio/prepare` para no generar
 * signed upload URLs con extensiones arbitrarias — nunca lanza, cualquier valor no-string cae
 * en `false` (mismo criterio que `resolveGroqModel`/`sanitizeTerm`).
 */
export function isAllowedAudioExtension(ext: unknown): ext is string {
  if (typeof ext !== "string" || !/^\.[a-zA-Z0-9]+$/.test(ext)) return false;
  return (ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(ext.slice(1).toLowerCase());
}

/**
 * Normaliza y valida el `audioName` (nombre de display) del flujo de subida directa a Storage —
 * usado tanto por `/api/audio/prepare` (validación temprana, antes de generar el signed URL)
 * como por `/api/transcribe` en modo `storagePath` (el blob en Storage tiene un nombre random —
 * UUID —, así que este es el nombre REAL que se guarda en `audio_name`). `null` si no es un
 * string o queda vacío después del trim — nunca lanza, mismo criterio que `sanitizeTerm`
 * (`src/lib/vocabulary/validate.ts`).
 */
export function sanitizeAudioName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

/**
 * true si `storagePath` pertenece a `userId` — el primer segmento del path DEBE ser el userId
 * (ver `buildAudioObjectPath`). Usado por `/api/transcribe` (modo `storagePath`, audio subido
 * directo a Storage por el desktop) ANTES de bajar el blob: sin este chequeo, un usuario podría
 * mandar el `storagePath` de otro y el server le devolvería su audio.
 */
export function isOwnedStoragePath(storagePath: unknown, userId: string): storagePath is string {
  return typeof storagePath === "string" && storagePath.length > 0 && storagePath.startsWith(`${userId}/`);
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
