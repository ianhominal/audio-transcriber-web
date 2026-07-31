/**
 * Uploads an audio file straight to Supabase Storage, bypassing Vercel's ~4.5 MB body cap.
 *
 * Three steps, same handshake the desktop app already uses:
 *   1. POST `/api/audio/prepare` → `{ path, signedUrl, apiKey }`
 *   2. PUT the bytes to `signedUrl` (the `apikey` header is mandatory on every `/storage/v1/`
 *      route, even with a signed token in the URL — without it Supabase answers 401)
 *   3. hand `path` to `/api/transcribe` as `storagePath` instead of putting the file in the body
 */

import { storageExtensionFor } from "./route";

export type StorageUploadResult = { ok: true; path: string } | { ok: false; message: string };

export async function uploadFileToStorage(file: File): Promise<StorageUploadResult> {
  const ext = storageExtensionFor(file.name);
  if (!ext) {
    return { ok: false, message: "Ese archivo no tiene una extensión que podamos reconocer." };
  }

  let prepared: { path?: unknown; signedUrl?: unknown; apiKey?: unknown };
  try {
    const res = await fetch("/api/audio/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioName: file.name, ext }),
    });
    // Same rule as everywhere else in this module: read text, never trust it to be JSON.
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, message: readError(raw) ?? "No se pudo preparar la subida. Probá de nuevo." };
    }
    prepared = JSON.parse(raw);
  } catch {
    return { ok: false, message: "No se pudo preparar la subida. Revisá tu conexión y probá de nuevo." };
  }

  const { path, signedUrl, apiKey } = prepared;
  if (typeof path !== "string" || typeof signedUrl !== "string" || typeof apiKey !== "string") {
    return { ok: false, message: "No se pudo preparar la subida. Probá de nuevo." };
  }

  try {
    const put = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        apikey: apiKey,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!put.ok) {
      return { ok: false, message: "No se pudo subir el audio. Probá de nuevo." };
    }
  } catch {
    // A dropped connection mid-upload lands here. The local copy still holds the audio, so the
    // caller can offer a retry that costs nothing but time.
    return { ok: false, message: "Se cortó la subida del audio. Reintentá cuando tengas mejor señal." };
  }

  return { ok: true, path };
}

function readError(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON — a platform error page. Never surface the raw body.
  }
  return null;
}
