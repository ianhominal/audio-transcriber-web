/**
 * Compatibilidad de esquema para `drive_connections.status`, agregada por la migración
 * `supabase/migrations/20260707140000_drive_connection_status.sql` (se aplica MANUALMENTE en
 * producción, igual que las demás — ver cabecera de `src/lib/supabase/schema-compat.ts`).
 *
 * Mismo patrón que ese módulo (detección por intento real contra la base + cache con TTL), pero
 * en un archivo SEPARADO a propósito: `schema-compat.ts` mantiene un único cache module-level
 * atado a UNA migración puntual (Drive-sync v2, `parent_project_id`/`sync_origin`). Si esta
 * columna compartiera ese mismo cache, un `available` de una migración pisaría el resultado de la
 * otra (son columnas y migraciones independientes) — cada columna necesita su propio cache.
 * `isMissingColumnError` sí se reusa: es genérica (detecta `42703` por código o mensaje).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, SCHEMA_COMPAT_CACHE_TTL_MS } from "@/lib/supabase/schema-compat";

export type DriveConnectionStatus = "active" | "revoked";

type StatusCompatCache = { available: boolean | null; checkedAt: number };
let cache: StatusCompatCache = { available: null, checkedAt: 0 };

function shouldRedetect(now: number): boolean {
  if (cache.available === null) return true;
  return now - cache.checkedAt > SCHEMA_COMPAT_CACHE_TTL_MS;
}

/** Solo para tests: vuelve el cache a su estado inicial (sin detección todavía). */
export function resetDriveConnectionStatusCacheForTests(): void {
  cache = { available: null, checkedAt: 0 };
}

/**
 * Trae el `status` de la conexión de Drive del usuario. `null` si no tiene fila en
 * `drive_connections` (nunca conectó, o el chip de Ajustes debe mostrar "Conectar"). Si la
 * columna `status` todavía no existe en el esquema real, degrada a `'active'` para cualquier
 * conexión existente — el comportamiento previo a esta feature (chip "conectado" por la sola
 * existencia de la fila).
 */
export async function getDriveConnectionStatusCompat(
  supabase: SupabaseClient,
  userId: string
): Promise<DriveConnectionStatus | null> {
  const now = Date.now();
  const useReducedDirectly = cache.available === false && !shouldRedetect(now);

  if (!useReducedDirectly) {
    const { data, error } = await supabase
      .from("drive_connections")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error) {
      cache = { available: true, checkedAt: now };
      if (!data) return null;
      const status = (data as { status?: string }).status;
      return status === "revoked" ? "revoked" : "active";
    }

    if (!isMissingColumnError(error)) {
      return null; // otro tipo de error (RLS, red, etc.): no hay nada confiable para reportar
    }
    cache = { available: false, checkedAt: now };
  }

  const { data } = await supabase
    .from("drive_connections")
    .select("connected_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? "active" : null;
}

/**
 * Marca la conexión de Drive del usuario como revocada (Google devolvió `invalid_grant` al
 * renovar el access token). Best-effort: si la columna `status` todavía no existe, es un no-op
 * silencioso — Ajustes sigue mostrando "conectado" hasta que se aplique la migración, igual que
 * el comportamiento previo a esta feature (no rompe el flujo de reautenticación, que ya funciona
 * por otro lado con el código `invalid_grant`/`needs-reauth`).
 */
export async function markDriveConnectionRevoked(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("drive_connections")
    .update({ status: "revoked" })
    .eq("user_id", userId);

  if (error) {
    if (isMissingColumnError(error)) {
      cache = { available: false, checkedAt: Date.now() };
    }
    return;
  }
  cache = { available: true, checkedAt: Date.now() };
}
