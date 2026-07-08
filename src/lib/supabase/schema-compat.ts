/**
 * Compatibilidad de esquema para las columnas nuevas de Drive-sync v2
 * (`projects.parent_project_id`, `projects.sync_origin`), agregadas por la migración
 * `supabase/migrations/20260707130000_drive_sync_v2_foundation.sql`.
 *
 * Esa migración se aplica MANUALMENTE en producción (no hay CI que la corra), así que el
 * código puede quedar desplegado antes de que las columnas existan realmente en la base. Este
 * módulo implementa el patrón expand/contract a nivel de columnas: se intenta la operación
 * completa y, si Postgres devuelve "column does not exist" (`42703`), se cae a una versión
 * reducida — sin degradar nada una vez que la migración YA está aplicada.
 *
 * Estrategia elegida: detección por INTENTO REAL contra la base (no una consulta previa a
 * information_schema). Motivo: evita un round-trip extra en el camino feliz y evita una
 * segunda fuente de verdad (information_schema) que podría desincronizarse del comportamiento
 * real de PostgREST ante ese request puntual.
 */

/** TTL del cache de disponibilidad de columnas. Corto a propósito: permite que el sistema se
 * "auto-cure" solo (sin redeploy) poco después de que el usuario corra la migración a mano. */
export const SCHEMA_COMPAT_CACHE_TTL_MS = 60_000;

type SchemaCompatCache = {
  available: boolean | null;
  checkedAt: number;
};

// Cache a NIVEL DE MÓDULO (variable de scope de módulo, no un objeto exportado mutable): un
// único estado compartido por toda la app (pull, push, cron, etc.) — todos los endpoints se
// sincronizan con una sola detección real, en vez de repetir el intento fallido por archivo.
let cache: SchemaCompatCache = { available: null, checkedAt: 0 };

/** Snapshot de solo lectura del cache actual (para uso en los route handlers). */
export function getSchemaCompatSnapshot(): SchemaCompatCache {
  return cache;
}

/**
 * true si conviene volver a detectar contra la base real: nunca se detectó todavía, o el
 * último resultado conocido ya venció su TTL. `now` es inyectable para tests.
 */
export function shouldRedetectSchemaCompat(now: number = Date.now()): boolean {
  if (cache.available === null) return true;
  return now - cache.checkedAt > SCHEMA_COMPAT_CACHE_TTL_MS;
}

/** Registra el resultado de un intento real contra la base (éxito o fallback). */
export function markSchemaCompatResult(available: boolean, now: number = Date.now()): void {
  cache = { available, checkedAt: now };
}

/** Solo para tests: vuelve el cache a su estado inicial (sin detección todavía). */
export function resetSchemaCompatCacheForTests(): void {
  cache = { available: null, checkedAt: 0 };
}

/**
 * true si el error de Supabase/PostgREST corresponde a una columna inexistente en la tabla
 * (`42703`). Como fallback (por si algún wrapper pierde el código), también matchea el mensaje
 * cuando menciona explícitamente "column" y "does not exist" juntos — el texto típico de
 * Postgres/PostgREST es `column "x" of relation "y" does not exist` o `column y.x does not
 * exist`. Estricto a propósito: NO matchea por código genérico `42xxx` (ej. `42501` permisos,
 * `42P01` tabla inexistente) ni por mensajes que solo mencionen "does not exist" sin hablar de
 * una columna (ej. función o tabla faltante), para no confundir un problema real de esquema/
 * conexión con el caso puntual que este módulo sabe resolver.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };

  if (typeof e.code === "string" && e.code === "42703") return true;

  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    if (msg.includes("column") && msg.includes("does not exist")) return true;
  }

  return false;
}

/**
 * Arma la fila a insertar/actualizar en `projects` agregando (o no) las columnas de
 * Drive-sync v2, según si están disponibles en el esquema real. Puro: no llama a Supabase.
 *
 * - `columnsAvailable = true`: devuelve `base` + las claves de `extra` cuyo valor no sea
 *   `undefined` (mismo criterio que "no tocar el campo" que ya usaba push/route.ts para
 *   `parent_project_id` opcional).
 * - `columnsAvailable = false`: devuelve `base` tal cual, SIN agregar ninguna clave de `extra`
 *   — ni siquiera en `undefined` — para que el objeto final no tenga esas claves (Supabase
 *   trata una clave presente con valor `undefined` como ausente al armar el request, pero acá
 *   evitamos la ambigüedad directamente no agregándola).
 */
export function buildProjectRow<Base extends Record<string, unknown>>(
  base: Base,
  extra: Record<string, unknown>,
  columnsAvailable: boolean
): Base {
  if (!columnsAvailable) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as Base;
}
