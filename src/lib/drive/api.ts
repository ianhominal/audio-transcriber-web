/**
 * Cliente de la Drive API v3 para el motor de sync server-side (doc 09, Fase 2).
 *
 * Distinto de `src/lib/googleDrive.ts` (export puntual desde el browser con el modelo de token de
 * GIS): acá el caller (`/api/cron/drive-sync`) ya tiene un access token vigente, renovado a partir
 * del refresh token guardado en `drive_connections` (ver `getAccessToken`). Todas las funciones
 * reciben el `accessToken` explícito — nada de estado global ni sesión de browser.
 */
import { GOOGLE_TOKEN_URL } from "./oauth";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_CHANGES_URL = "https://www.googleapis.com/drive/v3/changes";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Campos que devuelve `files.create`/`files.update` para poder registrar el mapeo sin otro round-trip. */
const FILE_FIELDS = "id,name,md5Checksum,modifiedTime";

/** Códigos de error de la Drive/OAuth API que ameritan reintentar con backoff (cuota/rate limit). */
const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError"]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 200;

/** Error de la Drive API (o de la renovación del token) con detalle legible y el status/código de Google. */
export class DriveApiError extends Error {
  status?: number;
  /** Código de Google: ej. `invalid_grant` (refresh token revocado) o `rateLimitExceeded`. */
  code?: string;
  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "DriveApiError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorBody(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const data = await res.json();
    const message: string =
      data?.error?.message || data?.error_description || data?.error || `Drive respondió ${res.status}.`;
    const code: string | undefined = data?.error?.errors?.[0]?.reason || data?.error;
    return { message, code };
  } catch {
    return { message: `Drive respondió ${res.status} sin detalle.` };
  }
}

/** `fetch` con Authorization + manejo de errores uniforme + reintento con backoff en errores de cuota. */
async function driveFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  let lastError: DriveApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new DriveApiError("No se pudo conectar con Google Drive. Revisá la conexión del servidor.");
    }

    if (res.ok) return res;

    const { message, code } = await parseErrorBody(res);
    lastError = new DriveApiError(message, { status: res.status, code });

    const retryable = (res.status === 429 || res.status === 403) && (!code || RETRYABLE_REASONS.has(code));
    if (!retryable || attempt === MAX_RETRIES) throw lastError;

    await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
  }

  // Inalcanzable (el loop siempre retorna o lanza), pero TypeScript necesita un valor/throw acá.
  throw lastError ?? new DriveApiError("Fallo desconocido llamando a Drive.");
}

function generateBoundary(): string {
  return `audio_transcriber_sync_${Math.random().toString(36).slice(2)}`;
}

/** Arma el body `multipart/related` (metadata JSON + contenido) para `files.create`/`files.update`. */
export function buildMultipartBody({
  name,
  mimeType,
  content,
  parents,
  boundary = generateBoundary(),
}: {
  name?: string;
  mimeType: string;
  content: string;
  parents?: string[];
  boundary?: string;
}): { headers: Record<string, string>; body: string } {
  const metadata: Record<string, unknown> = { mimeType };
  if (name !== undefined) metadata.name = name;
  if (parents) metadata.parents = parents;

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  return { headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body };
}

export type DriveFileResult = {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime?: string;
};

/**
 * Renueva el access token con el refresh token guardado (grant_type=refresh_token). El backend
 * nunca guarda el access token (vive ~1h): se pide on-demand en cada tick.
 * `invalid_grant` en `code` significa que el refresh token fue revocado → hace falta reconectar.
 */
export async function getAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    throw new DriveApiError("No se pudo conectar con Google para renovar el token de Drive.");
  }

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (!res.ok || data.error) {
    const message =
      (data.error_description as string) || (data.error as string) || `Google rechazó la renovación (${res.status}).`;
    throw new DriveApiError(message, { status: res.status, code: data.error as string | undefined });
  }
  if (!data.access_token) {
    throw new DriveApiError("Google no devolvió un access_token al renovar.");
  }
  return data.access_token as string;
}

/** `changes.getStartPageToken`: cursor baseline para empezar a escuchar cambios desde "ahora". */
export async function getStartPageToken(accessToken: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_CHANGES_URL}/startPageToken`, accessToken);
  const data = await res.json();
  if (!data.startPageToken) {
    throw new DriveApiError("Drive no devolvió startPageToken.");
  }
  return data.startPageToken as string;
}

export type RawDriveChange = {
  fileId: string;
  removed: boolean;
  file?: {
    name?: string;
    trashed?: boolean;
    modifiedTime?: string;
    md5Checksum?: string;
  };
};

export type ListChangesResult = {
  changes: RawDriveChange[];
  nextPageToken: string | null;
  newStartPageToken: string | null;
};

/** `changes.list`: una página de cambios desde `pageToken`. El caller pagina hasta que no haya `nextPageToken`. */
export async function listChanges(accessToken: string, pageToken: string): Promise<ListChangesResult> {
  const params = new URLSearchParams({
    pageToken,
    pageSize: "100",
    fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(name,trashed,modifiedTime,md5Checksum))",
  });
  const res = await driveFetch(`${DRIVE_CHANGES_URL}?${params.toString()}`, accessToken);
  const data = await res.json();
  return {
    changes: (data.changes ?? []) as RawDriveChange[],
    nextPageToken: (data.nextPageToken as string) ?? null,
    newStartPageToken: (data.newStartPageToken as string) ?? null,
  };
}

/** `files.create` de tipo carpeta. `parentId` opcional (sin él, va a la raíz "Mi unidad" del usuario). */
export async function createFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<{ id: string; name: string }> {
  const res = await driveFetch(`${DRIVE_FILES_URL}?fields=id,name`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: parentId ? [parentId] : undefined }),
  });
  return res.json();
}

/** `files.create` con contenido (multipart): sube un archivo nuevo dentro de `folderId`. */
export async function uploadFile(
  accessToken: string,
  folderId: string,
  name: string,
  mimeType: string,
  content: string
): Promise<DriveFileResult> {
  const { headers, body } = buildMultipartBody({ name, mimeType, content, parents: [folderId] });
  const res = await driveFetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=${FILE_FIELDS}`, accessToken, {
    method: "POST",
    headers,
    body,
  });
  return res.json();
}

/** `files.update` con contenido (multipart): reemplaza el contenido de un archivo existente. */
export async function updateFile(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType = "text/markdown"
): Promise<DriveFileResult> {
  const { headers, body } = buildMultipartBody({ mimeType, content });
  const res = await driveFetch(
    `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=multipart&fields=${FILE_FIELDS}`,
    accessToken,
    { method: "PATCH", headers, body }
  );
  return res.json();
}

/** `files.get?alt=media`: baja el contenido crudo (texto) de un archivo. */
export async function getFileContent(accessToken: string, fileId: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, accessToken);
  return res.text();
}

/** Mueve un archivo a la papelera de Drive (recuperable), en vez de borrarlo en duro. */
export async function trashFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_FILES_URL}/${fileId}`, accessToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Borrado en duro (no recuperable). No lo usa el motor de sync hoy; queda para limpieza manual/futura. */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_FILES_URL}/${fileId}`, accessToken, { method: "DELETE" });
}
