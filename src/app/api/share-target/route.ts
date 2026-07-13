import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { getUserSettings } from "@/lib/settings/user-settings";
import { defaultTitleFromFileName } from "@/lib/format";
import { SHARE_TARGET_FILE_FIELD, SHARE_TARGET_MAX_FILES } from "@/lib/share-target";
import { POST as transcribePost } from "@/app/api/transcribe/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Receiving end of the PWA `share_target` (see `manifest.ts`): when the user shares an audio file
 * from another app (WhatsApp, a voice recorder, a file manager) to this installed PWA, the browser
 * POSTs it here as `multipart/form-data`, with the file(s) under the `SHARE_TARGET_FILE_FIELD`
 * field — MUST match `share_target.params.files[0].name` in `manifest.ts` exactly (see
 * `@/lib/share-target`, the shared source of truth for that name).
 *
 * Per the Web Share Target spec, this must respond with a redirect (303 — avoids a duplicate POST
 * on refresh) rather than a JSON/page body, so on success we land the user on the result and on
 * failure we send them to `/app/capturar` with the reason.
 *
 * KNOWN LIMITATION: a shared file over Vercel's ~4.5 MB request body limit never reaches this
 * handler at all — the platform rejects it before any of our code runs, so the user sees a raw
 * network error instead of our friendly `shareError` redirect. `TranscribeWorkspace`/`capturar`
 * can pre-check size client-side because they control the upload; a share_target POST comes
 * straight from the OS share sheet, before any of our JS executes, so there's nothing to
 * intercept. Acceptable for now: real-world shared voice notes are almost always well under this
 * limit (opus-compressed WhatsApp notes run a few hundred KB even for several minutes) — a shared
 * full song or long raw recording is the realistic failure case, and it still fails SAFELY (no
 * data loss, just a platform error page instead of a styled one).
 *
 * Implementation note: we import and call `/api/transcribe`'s `POST` handler DIRECTLY (no network
 * hop) instead of duplicating its auth/rate-limit/dedupe/save logic — this is the same request's
 * execution context, so `next/headers`' `cookies()` (used by `getApiUser`'s cookie-session branch,
 * see `@/lib/supabase/server`) still resolves from the ORIGINAL incoming request even though we
 * hand it a synthetic `NextRequest`. That synthetic request must NOT reuse `req.headers` as-is:
 * doing so would carry over this request's own multipart `Content-Type` (with ITS boundary), which
 * would conflict with the fresh `FormData` body below — each `FormData` needs its own boundary,
 * computed automatically only when `Content-Type` is left unset.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url), 303);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(captureErrorUrl(req, "No pudimos leer el audio compartido."), 303);
  }

  const sharedFiles = form
    .getAll(SHARE_TARGET_FILE_FIELD)
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (sharedFiles.length === 0) {
    return NextResponse.redirect(captureErrorUrl(req, "No se recibió ningún audio compartido."), 303);
  }
  // Cota dura de archivos por share (ver `SHARE_TARGET_MAX_FILES`): el resto de lo compartido de
  // más se ignora en silencio — es un caso borde raro (multi-selección manual desde un explorador
  // de archivos), y la alternativa (bloquear todo el share por exceder la cota) sería peor.
  const files = sharedFiles.slice(0, SHARE_TARGET_MAX_FILES);

  const defaults = await getUserSettings(supabase, user.id);

  let lastId: string | null = null;
  let okCount = 0;
  let failCount = 0;
  let lastError = "No se pudo transcribir el audio compartido.";

  // Serial, same as TranscribeWorkspace.run(): respects Groq's rate limit and keeps one file's
  // failure from aborting the rest of the share (Android lets the user multi-select files to share).
  for (const file of files) {
    const forwardForm = new FormData();
    // "file" here is a DIFFERENT contract from `SHARE_TARGET_FILE_FIELD` above (same string value
    // today, coincidentally) — this one has to match what `/api/transcribe/route.ts` itself reads
    // via `form.get("file")`, not the manifest's share_target field name.
    forwardForm.append("file", file, file.name || "audio");
    forwardForm.append("language", defaults.language);
    forwardForm.append("model", defaults.quality);
    forwardForm.append("mode", "transcribe");
    forwardForm.append("title", defaultTitleFromFileName(file.name || "Audio compartido"));

    const forwardHeaders = new Headers();
    // Only relevant for the desktop-client Bearer path — the web cookie-session path doesn't need
    // this forwarded (see the ambient-`cookies()` note above), but forwarding it too is harmless.
    const authorization = req.headers.get("authorization");
    if (authorization) forwardHeaders.set("authorization", authorization);

    try {
      const forwardReq = new NextRequest(new URL("/api/transcribe", req.url), {
        method: "POST",
        headers: forwardHeaders,
        body: forwardForm,
      });
      const resp = await transcribePost(forwardReq);
      const data = await resp.json();
      if (resp.ok) {
        okCount++;
        if (typeof data.id === "string") lastId = data.id;
      } else {
        failCount++;
        lastError = data?.error || lastError;
      }
    } catch (err) {
      failCount++;
      console.error("[share-target] forwarding to /api/transcribe threw", err);
    }
  }

  if (okCount === 0) {
    return NextResponse.redirect(captureErrorUrl(req, lastError), 303);
  }
  if (okCount === 1 && failCount === 0 && lastId) {
    return NextResponse.redirect(new URL(`/app/t/${lastId}`, req.url), 303);
  }
  // Múltiples archivos compartidos a la vez: sin una pantalla de resumen dedicada (fuera de
  // alcance por ahora, ver reporte), mandamos al dashboard — las transcripciones ya quedaron
  // guardadas y visibles ahí.
  return NextResponse.redirect(new URL("/app", req.url), 303);
}

function captureErrorUrl(req: NextRequest, message: string): URL {
  const url = new URL("/app/capturar", req.url);
  url.searchParams.set("shareError", message);
  return url;
}
