/**
 * Exportar a Google Drive vía Google Identity Services (GIS), modelo de token.
 *
 * A propósito NO usa el login de Supabase ni su `provider_token`: ese token no se refresca y
 * pedirle el scope de Drive obligaría a re-loguear a todos los usuarios existentes. En cambio,
 * este flujo pide un access token de Drive ON-DEMAND (cuando el usuario aprieta "Exportar a
 * Drive"), sin tocar el login existente. Ver investigación en el changelog del 2026-07-07.
 */

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClientError = {
  type?: "popup_failed_to_open" | "popup_closed" | "unknown" | string;
  message?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: GoogleTokenClientError) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;

/** Inyecta el script de Google Identity Services una sola vez y resuelve cuando está listo para usarse. */
export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Esto solo funciona desde el navegador."));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("No se pudo conectar con Google. Probá de nuevo."))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo conectar con Google. Probá de nuevo."));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

export type DriveAuthErrorReason =
  | "missing-client-id"
  | "popup-closed"
  | "popup-blocked"
  | "access-denied"
  | "unknown";

/** Error de autenticación/autorización con Google (popup cerrado, permiso denegado, config faltante, etc). */
export class DriveAuthError extends Error {
  reason: DriveAuthErrorReason;
  constructor(reason: DriveAuthErrorReason, message: string) {
    super(message);
    this.name = "DriveAuthError";
    this.reason = reason;
  }
}

/**
 * Pide un access token de Drive ON-DEMAND con el modelo de token de GIS
 * (`google.accounts.oauth2.initTokenClient` + `requestAccessToken`). Abre un popup de Google;
 * el usuario elige cuenta y otorga (o deniega) el permiso `drive.file`.
 */
export async function requestGoogleDriveAccessToken(clientId: string | undefined): Promise<string> {
  if (!clientId) {
    throw new DriveAuthError(
      "missing-client-id",
      "Falta configurar NEXT_PUBLIC_GOOGLE_CLIENT_ID para exportar a Google Drive."
    );
  }

  await loadGoogleIdentityScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new DriveAuthError("unknown", "No se pudo conectar con Google. Probá de nuevo.");
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response?.access_token) {
          resolve(response.access_token);
          return;
        }
        if (response?.error === "access_denied") {
          reject(new DriveAuthError("access-denied", "Denegaste el permiso de acceso a Google Drive."));
          return;
        }
        reject(new DriveAuthError("unknown", "Google no devolvió un token de acceso."));
      },
      error_callback: (err) => {
        if (err?.type === "popup_closed") {
          reject(new DriveAuthError("popup-closed", "Cerraste la ventana de Google antes de autorizar."));
        } else if (err?.type === "popup_failed_to_open") {
          reject(
            new DriveAuthError(
              "popup-blocked",
              "El navegador bloqueó la ventana de Google. Habilitá los popups e intentá de nuevo."
            )
          );
        } else {
          reject(new DriveAuthError("unknown", "No se pudo autenticar con Google."));
        }
      },
    });
    client.requestAccessToken();
  });
}

export type DriveUploadRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

function generateBoundary(): string {
  return `audio_transcriber_web_${Math.random().toString(36).slice(2)}`;
}

/**
 * Arma el POST multipart/related para `files?uploadType=multipart` (metadata JSON + contenido).
 * Función PURA (sin fetch/DOM) para poder testearla con Vitest en entorno node.
 */
export function buildDriveMultipartUpload({
  fileName,
  mimeType,
  content,
  boundary = generateBoundary(),
}: {
  fileName: string;
  mimeType: string;
  content: string;
  boundary?: string;
}): DriveUploadRequest {
  const metadata = JSON.stringify({ name: fileName, mimeType });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  return {
    url: DRIVE_UPLOAD_URL,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  };
}

export type DriveUploadResult = { id: string; name: string };

/** Sube el contenido a Drive como archivo nuevo con el access token ya obtenido. */
export async function uploadMarkdownToDrive({
  accessToken,
  fileName,
  content,
}: {
  accessToken: string;
  fileName: string;
  content: string;
}): Promise<DriveUploadResult> {
  const { url, headers, body } = buildDriveMultipartUpload({
    fileName,
    mimeType: "text/markdown",
    content,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      body,
    });
  } catch {
    throw new Error("No se pudo conectar con Google Drive. Revisá tu conexión.");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.error?.message ?? "";
    } catch {
      // Respuesta sin body JSON parseable: seguimos con el status.
    }
    throw new Error(
      detail ? `Google Drive rechazó la subida: ${detail}` : `Google Drive rechazó la subida (${res.status}).`
    );
  }

  return res.json();
}
