/**
 * Which way an audio file reaches `/api/transcribe`.
 *
 * Vercel caps a serverless function's body at ~4.5 MB, which used to be the hard ceiling for the
 * whole web app — a 6 MB voice note simply could not be transcribed here. But the way around it
 * already existed: `/api/audio/prepare` hands out a signed upload URL, the file goes STRAIGHT to
 * Supabase Storage (bucket limit 50 MB), and `/api/transcribe` reads it from there via
 * `storagePath`. It was built for the desktop app uploading long meetings; the web never used it.
 *
 * So the real ceiling is Groq's 25 MB, not Vercel's 4.5 MB.
 */

import { WEB_MAX_BYTES } from "@/lib/recording";

/** Groq rejects anything larger — `/api/transcribe` enforces the same number server-side. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export type UploadRoute = "body" | "storage" | "too-large";

/**
 * Small files keep the single-request path: it is one round trip instead of three, and it is the
 * code path that has been in production all along. Bigger ones detour through Storage. Anything
 * over Groq's limit is rejected here rather than after burning the upload.
 */
export function chooseUploadRoute(sizeBytes: number): UploadRoute {
  if (Number.isNaN(sizeBytes)) return "too-large";
  if (sizeBytes <= WEB_MAX_BYTES) return "body";
  if (sizeBytes <= TRANSCRIBE_MAX_BYTES) return "storage";
  return "too-large";
}

/**
 * Extension with the leading dot, the shape `/api/audio/prepare` validates against its allowlist.
 * Null when there is nothing usable — without it the signed URL cannot be requested.
 */
export function storageExtensionFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot).toLowerCase();
  return /^\.[a-z0-9]+$/.test(ext) ? ext : null;
}
