/**
 * Constantes y helpers compartidos por `/api/drive/connect` y `/api/drive/callback`
 * (flujo OAuth offline de Drive-sync, doc 09 Fase 1).
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// El `state` es válido por 10 minutos: alcanza de sobra para el ida-y-vuelta con Google y
// acota la ventana de un state firmado que quedó dando vueltas (ej. en logs, historial).
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** `redirect_uri` del callback: DEBE ser exactamente igual en `/connect` y `/callback` (Google lo exige). */
export function driveCallbackUrl(origin: string): string {
  return new URL("/api/drive/callback", origin).toString();
}

export type DriveOAuthState = { uid: string; nonce: string; iat: number };
