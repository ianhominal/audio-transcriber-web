/**
 * Constantes y helpers compartidos por `/api/drive/connect` y `/api/drive/callback`
 * (flujo OAuth offline de Drive-sync, doc 09/10).
 */

// Scope RESTRINGIDO (no `drive.file`): decisión de doc 10 — importar carpetas EXISTENTES con
// subcarpetas exige poder recorrer un árbol que no creó la app (`files.list` con `'<id>' in
// parents` sobre hijos ajenos), y eso NO es posible con `drive.file` (solo ve lo que la app
// crea o el usuario elige explícitamente, sin recursión). Con `drive` (restringido) en modo
// **Testing** de Google Cloud Console funciona sin trámite para el dueño y los testers
// agregados a mano (hasta 100), SIN pasar la evaluación CASA — CASA solo se exige para
// publicar la app a usuarios de Google externos sin agregarlos a mano (fuera de alcance hoy).
//
// ⚠️ CONFIG que necesita el dueño (no es código):
//   1. Google Cloud Console → OAuth consent screen → Data access → agregar el scope
//      `https://www.googleapis.com/auth/drive` (además del `drive.file` que ya estaba).
//   2. Volver a conectar Drive desde `/app/ajustes` ("Conectar Google Drive"): el refresh token
//      guardado hoy en `drive_connections` se emitió con `drive.file` y NO alcanza el scope
//      nuevo — hay que regenerarlo pasando de nuevo por el consentimiento (`prompt=consent`
//      ya está seteado en `/api/drive/connect`, así que Google vuelve a pedir permiso).
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
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
