/**
 * Compatibilidad de esquema para columnas de `projects` que se agregan vía migraciones que NO
 * corren solas en producción (se aplican automático recién al mergear a `main`, integración
 * Supabase↔GitHub — ver cada migración referenciada abajo), así que el código puede quedar
 * desplegado/en preview antes de que la columna exista realmente en la base. Este módulo
 * implementa el patrón expand/contract a nivel de columnas: se intenta la operación completa y,
 * si Postgres devuelve "column does not exist" (`42703`), se cae a una versión reducida — sin
 * degradar nada una vez que la migración YA está aplicada.
 *
 * Estrategia elegida: detección por INTENTO REAL contra la base (no una consulta previa a
 * information_schema). Motivo: evita un round-trip extra en el camino feliz y evita una
 * segunda fuente de verdad (information_schema) que podría desincronizarse del comportamiento
 * real de PostgREST ante ese request puntual.
 *
 * Dos migraciones distintas tocan `projects` con este mismo problema (Drive-sync v2:
 * `parent_project_id`/`sync_origin`; F2: `color`) y pueden estar en estados de aplicación
 * INDEPENDIENTES entre sí — por eso cada grupo tiene su propio cache (`createSchemaCompatCache`),
 * en vez de un único booleano que confundiría "falta color" con "falta toda la jerarquía".
 */

/** TTL del cache de disponibilidad de columnas. Corto a propósito: permite que el sistema se
 * "auto-cure" solo (sin redeploy) poco después de que la migración termine de aplicarse. */
export const SCHEMA_COMPAT_CACHE_TTL_MS = 60_000;

type SchemaCompatCache = {
  available: boolean | null;
  checkedAt: number;
};

/**
 * Fábrica de un cache de disponibilidad de columna(s), a NIVEL DE MÓDULO (closure, no un objeto
 * exportado mutable): un único estado compartido por toda la app (pull, push, cron, etc.) por
 * cada grupo de columnas — todos los endpoints se sincronizan con una sola detección real, en vez
 * de repetir el intento fallido por archivo.
 */
function createSchemaCompatCache() {
  let cache: SchemaCompatCache = { available: null, checkedAt: 0 };

  return {
    /** Snapshot de solo lectura del cache actual (para uso en los route handlers). */
    getSnapshot(): SchemaCompatCache {
      return cache;
    },
    /**
     * true si conviene volver a detectar contra la base real: nunca se detectó todavía, o el
     * último resultado conocido ya venció su TTL. `now` es inyectable para tests.
     */
    shouldRedetect(now: number = Date.now()): boolean {
      if (cache.available === null) return true;
      return now - cache.checkedAt > SCHEMA_COMPAT_CACHE_TTL_MS;
    },
    /** Registra el resultado de un intento real contra la base (éxito o fallback). */
    markResult(available: boolean, now: number = Date.now()): void {
      cache = { available, checkedAt: now };
    },
    /** Solo para tests: vuelve el cache a su estado inicial (sin detección todavía). */
    resetForTests(): void {
      cache = { available: null, checkedAt: 0 };
    },
  };
}

// ---------- Drive-sync v2: `projects.parent_project_id` / `projects.sync_origin`
// (supabase/migrations/20260707130000_drive_sync_v2_foundation.sql) ----------
const driveSyncV2Cache = createSchemaCompatCache();

export const getSchemaCompatSnapshot = driveSyncV2Cache.getSnapshot;
export const shouldRedetectSchemaCompat = driveSyncV2Cache.shouldRedetect;
export const markSchemaCompatResult = driveSyncV2Cache.markResult;
export const resetSchemaCompatCacheForTests = driveSyncV2Cache.resetForTests;

// ---------- F2: `projects.color`
// (supabase/migrations/20260709200000_project_color.sql) ----------
const projectColorCache = createSchemaCompatCache();

export const getProjectColorCompatSnapshot = projectColorCache.getSnapshot;
export const shouldRedetectProjectColorCompat = projectColorCache.shouldRedetect;
export const markProjectColorCompatResult = projectColorCache.markResult;
export const resetProjectColorCompatCacheForTests = projectColorCache.resetForTests;

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
 * true si el error de Supabase/PostgREST corresponde a una TABLA inexistente ("relation ... does
 * not exist", `42P01`) — a diferencia de `isMissingColumnError` (`42703`, columna faltante en una
 * tabla que SÍ existe). Hace falta un detector aparte porque una tabla NUEVA (no una columna
 * agregada a una tabla existente) falla con un código distinto antes de que su migración se
 * aplique — mismo caso que documenta `vocabulary_terms`
 * (`supabase/migrations/20260710120000_user_vocabulary.sql`) y, ahora, `ai_usage_log`
 * (`supabase/migrations/20260710130000_ai_usage_log.sql`, ver `src/lib/aiUsage.ts`). Estricto a
 * propósito, mismo criterio que `isMissingColumnError`: NO matchea por código genérico `42xxx` ni
 * por mensajes que no mencionen explícitamente una relación inexistente.
 *
 * OJO con el fallback por mensaje (corrección del re-juicio del review adversarial 2026-07-10): el
 * mensaje real de columna faltante de Postgres es `column "x" of relation "y" does not exist`, que
 * TAMBIÉN contiene "relation" y "does not exist" — así que hay que EXCLUIR explícitamente los que
 * mencionen "column", si no un 42703 sin código (algún wrapper que lo pierda) se confundiría con un
 * 42P01. El camino por `code` es el confiable; este fallback es solo un backstop.
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };

  if (typeof e.code === "string" && e.code === "42P01") return true;

  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    if (msg.includes("relation") && msg.includes("does not exist") && !msg.includes("column")) return true;
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
