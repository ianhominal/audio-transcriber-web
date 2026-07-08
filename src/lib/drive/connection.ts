/**
 * Helper de conexión: renueva y devuelve un access token vigente para el usuario logueado, a
 * partir del refresh token guardado en `drive_connections`. Mismo criterio que `syncOneUser` en
 * `/api/cron/drive-sync`, extraído acá para reusar en las rutas de selector/importación de
 * carpetas (`/api/drive/folders*`, doc 10) sin duplicar el decrypt + `getAccessToken`.
 *
 * Archivo separado (no `oauth.ts`) a propósito: evita un import circular con `api.ts`
 * (`getAccessToken` vive ahí, y `api.ts` a su vez importa constantes de `oauth.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { getAccessToken, DriveApiError } from "./api";
import { markDriveConnectionRevoked } from "./connection-status-compat";

/** El usuario no tiene fila en `drive_connections` (nunca conectó, o revocó el permiso). */
export class DriveNotConnectedError extends Error {
  constructor() {
    super("Todavía no conectaste tu cuenta de Google Drive.");
    this.name = "DriveNotConnectedError";
  }
}

export async function getUserDriveAccessToken(
  supabase: SupabaseClient,
  userId: string,
  config: { clientId: string; clientSecret: string; tokenKey: string }
): Promise<string> {
  const { data } = await supabase
    .from("drive_connections")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.refresh_token_encrypted) {
    throw new DriveNotConnectedError();
  }
  const refreshToken = decryptSecret(data.refresh_token_encrypted as string, config.tokenKey);
  try {
    return await getAccessToken(refreshToken, config.clientId, config.clientSecret);
  } catch (err) {
    // `invalid_grant` = Google revocó el refresh token: el chip "conectado" de Ajustes mentiría
    // si no reflejamos esto (ver migración `20260707140000_drive_connection_status.sql`).
    if (err instanceof DriveApiError && err.code === "invalid_grant") {
      await markDriveConnectionRevoked(supabase, userId);
    }
    throw err;
  }
}
