import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { decryptSecret } from "@/lib/crypto";
import { bearerSecretFromHeader, isAuthorizedCronSecret } from "@/lib/cronAuth";
import {
  getAccessToken,
  getStartPageToken,
  listChanges,
  createFolder,
  uploadFile,
  updateFile,
  getFileContent,
  trashFile,
  DriveApiError,
  type RawDriveChange,
} from "@/lib/drive/api";
import {
  reconcileDriveSync,
  computeContentHash,
  type CloudTranscriptionInput,
  type DriveFileMapEntry,
  type DriveChangeInput,
  type ReconcileAction,
} from "@/lib/drive/reconcile";
import { parseMarkdownExport } from "@/lib/format";

export const runtime = "nodejs";

const ROOT_FOLDER_NAME = "Audio Transcriber";

/**
 * Motor de sync Drive ↔ nube (doc 09, Fase 2). Corre "como sistema" (sin usuario logueado), igual
 * que `api/cron/purge`: usa el service-role client (bypassea RLS a propósito) para recorrer TODAS
 * las conexiones de Drive, no solo la de quien dispara el request.
 *
 * Disparador: pensado para correr cada ~10 min, pero Vercel Hobby solo permite 1 cron/día. Este
 * endpoint queda listo para cualquier disparador externo (cron-job.org, GitHub Actions, etc.) que
 * pegue acá cada N minutos con el `CRON_SECRET` — ver detalle en el changelog del 2026-07-07.
 *
 * Best-effort por usuario: si un usuario falla (token revocado, Drive caído, lo que sea), se
 * loguea y se sigue con los demás — un solo fallo no frena el resto de los ticks.
 */
export async function GET(req: NextRequest) {
  const authorized = isAuthorizedCronSecret(
    bearerSecretFromHeader(req.headers.get("authorization")),
    req.nextUrl.searchParams.get("secret"),
    process.env.CRON_SECRET
  );
  if (!authorized) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) {
    return NextResponse.json({ error: "Falta configuración de Drive en el servidor." }, { status: 500 });
  }

  const supabase = createServiceRoleClient();

  const { data: connections, error: connError } = await supabase
    .from("drive_connections")
    .select("user_id, refresh_token_encrypted, start_page_token, root_folder_id");

  if (connError) {
    return NextResponse.json({ error: "No se pudieron leer las conexiones de Drive." }, { status: 500 });
  }

  const results: UserSyncResult[] = [];

  for (const conn of connections ?? []) {
    try {
      const result = await syncOneUser(supabase, conn, { clientId, clientSecret, tokenKey });
      results.push({ userId: conn.user_id, ok: true, ...result });
    } catch (err) {
      // Best-effort: un usuario que falla no frena a los demás (ver doc del endpoint arriba).
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/drive-sync] error sincronizando usuario ${conn.user_id}:`, message);
      results.push({
        userId: conn.user_id,
        ok: false,
        error: message,
        needsReauth: err instanceof DriveApiError && err.code === "invalid_grant",
      });
    }
  }

  return NextResponse.json({ syncedUsers: results.length, results });
}

type UserSyncResult = {
  userId: string;
  ok: boolean;
  error?: string;
  needsReauth?: boolean;
  pushed?: number;
  pulled?: number;
  deletedInDrive?: number;
  deletedLocal?: number;
  conflicts?: number;
  massDeleteGuardTriggered?: boolean;
};

type DriveConnectionRow = {
  user_id: string;
  refresh_token_encrypted: string;
  start_page_token: string | null;
  root_folder_id: string | null;
};

type TranscriptionRow = {
  id: string;
  title: string;
  audio_name: string;
  text: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Nombre a mostrar de una transcripción: `title` si tiene, si no `audio_name` (mismo criterio que `transcription-row.tsx`). */
function displayTitle(t: Pick<TranscriptionRow, "title" | "audio_name">): string {
  return t.title || t.audio_name || "Sin título";
}

function conflictFileName(fileName: string): string {
  return fileName.endsWith(".md") ? `${fileName.slice(0, -3)} (conflicto).md` : `${fileName} (conflicto)`;
}

async function syncOneUser(
  supabase: SupabaseClient,
  conn: DriveConnectionRow,
  config: { clientId: string; clientSecret: string; tokenKey: string }
): Promise<Omit<UserSyncResult, "userId" | "ok">> {
  const refreshToken = decryptSecret(conn.refresh_token_encrypted, config.tokenKey);
  const accessToken = await getAccessToken(refreshToken, config.clientId, config.clientSecret);

  // ---- Setup on-demand: carpeta raíz y baseline del cursor, si es la primera corrida ----
  let rootFolderId = conn.root_folder_id;
  if (!rootFolderId) {
    const folder = await createFolder(accessToken, ROOT_FOLDER_NAME);
    rootFolderId = folder.id;
  }

  let startPageToken = conn.start_page_token;
  if (!startPageToken) {
    startPageToken = await getStartPageToken(accessToken);
  }

  // ---- 1. Traer todos los cambios de Drive desde el cursor, paginando ----
  const rawChanges: RawDriveChange[] = [];
  let pageToken: string | null = startPageToken;
  let newStartPageToken = startPageToken;
  while (pageToken) {
    const page = await listChanges(accessToken, pageToken);
    rawChanges.push(...page.changes);
    if (page.newStartPageToken) newStartPageToken = page.newStartPageToken;
    pageToken = page.nextPageToken;
  }
  const driveChanges: DriveChangeInput[] = rawChanges.map((c) => ({
    fileId: c.fileId,
    removed: c.removed,
    trashed: !!c.file?.trashed,
    name: c.file?.name ?? null,
    modifiedTime: c.file?.modifiedTime ?? null,
    md5Checksum: c.file?.md5Checksum ?? null,
  }));

  // ---- 2. Estado local: transcripciones del usuario + mapeo activo ----
  const { data: transcriptionsRaw } = await supabase
    .from("transcriptions")
    .select("id, title, audio_name, text, project_id, created_at, updated_at, deleted_at")
    .eq("user_id", conn.user_id);
  const transcriptionRows = (transcriptionsRaw ?? []) as TranscriptionRow[];
  const transcriptionRowById = new Map(transcriptionRows.map((t) => [t.id, t]));

  const { data: projectsRaw } = await supabase.from("projects").select("id, name").eq("user_id", conn.user_id);
  const projectNameById = new Map((projectsRaw ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

  const transcriptions: CloudTranscriptionInput[] = transcriptionRows.map((t) => ({
    id: t.id,
    title: displayTitle(t),
    text: t.text ?? "",
    projectName: t.project_id ? (projectNameById.get(t.project_id) ?? null) : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at,
  }));

  const { data: mapRowsRaw } = await supabase
    .from("drive_file_map")
    .select("drive_file_id, local_id, content_hash")
    .eq("user_id", conn.user_id)
    .eq("kind", "transcription")
    .is("deleted_at", null);
  const fileMap: DriveFileMapEntry[] = (mapRowsRaw ?? []).map(
    (m: { drive_file_id: string; local_id: string; content_hash: string | null }) => ({
      driveFileId: m.drive_file_id,
      transcriptionId: m.local_id,
      contentHash: m.content_hash,
    })
  );

  // ---- 3. Reconciliar (función pura, sin I/O) ----
  const { actions, massDeleteGuardTriggered } = reconcileDriveSync({ transcriptions, fileMap, driveChanges });

  // ---- 4. Ejecutar las acciones contra Drive + Supabase ----
  const now = new Date().toISOString();
  const counters = { pushed: 0, pulled: 0, deletedInDrive: 0, deletedLocal: 0, conflicts: 0 };

  for (const action of actions) {
    await applyAction(supabase, accessToken, conn.user_id, rootFolderId, transcriptionRowById, action, now, counters);
  }

  // ---- 5. Avanzar el cursor + guardar la carpeta raíz si se creó recién ----
  await supabase
    .from("drive_connections")
    .update({ root_folder_id: rootFolderId, start_page_token: newStartPageToken, updated_at: now })
    .eq("user_id", conn.user_id);

  return { ...counters, massDeleteGuardTriggered };
}

type Counters = { pushed: number; pulled: number; deletedInDrive: number; deletedLocal: number; conflicts: number };

async function applyAction(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  rootFolderId: string,
  transcriptionRowById: Map<string, TranscriptionRow>,
  action: ReconcileAction,
  now: string,
  counters: Counters
): Promise<void> {
  switch (action.type) {
    case "push_create": {
      const created = await uploadFile(accessToken, rootFolderId, action.fileName, "text/markdown", action.content);
      await supabase.from("drive_file_map").upsert(
        {
          user_id: userId,
          drive_file_id: created.id,
          kind: "transcription",
          local_id: action.transcriptionId,
          content_hash: created.md5Checksum ?? action.contentHash,
          deleted_at: null,
        },
        { onConflict: "user_id,drive_file_id" }
      );
      counters.pushed++;
      return;
    }

    case "push_update": {
      if (action.isConflict) {
        // Salvaguarda anti-pisada-silenciosa: antes de pisar Drive con la versión de la nube,
        // guardamos una copia del contenido de Drive que se pierde.
        try {
          const losing = await getFileContent(accessToken, action.driveFileId);
          await uploadFile(accessToken, rootFolderId, conflictFileName(action.fileName), "text/markdown", losing);
        } catch (err) {
          console.error(`[cron/drive-sync] no se pudo guardar copia de conflicto (push) para ${action.driveFileId}:`, err);
        }
        counters.conflicts++;
      }
      const updated = await updateFile(accessToken, action.driveFileId, action.content, "text/markdown");
      await supabase
        .from("drive_file_map")
        .update({ content_hash: updated.md5Checksum ?? action.contentHash })
        .eq("user_id", userId)
        .eq("drive_file_id", action.driveFileId);
      counters.pushed++;
      return;
    }

    case "pull_update": {
      const content = await getFileContent(accessToken, action.driveFileId);
      const parsed = parseMarkdownExport(content);

      if (action.isConflict) {
        // Salvaguarda anti-pisada-silenciosa: antes de pisar el texto local, guardamos una
        // copia de la versión local que se pierde como transcripción nueva "(conflicto)".
        const losing = transcriptionRowById.get(action.transcriptionId);
        if (losing) {
          await supabase.from("transcriptions").insert({
            user_id: userId,
            project_id: losing.project_id,
            title: `${displayTitle(losing)} (conflicto)`,
            audio_name: losing.audio_name,
            text: losing.text,
          });
        }
        counters.conflicts++;
      }

      const update: Record<string, unknown> = { text: parsed.text, deleted_at: null };
      if (parsed.title) update.title = parsed.title;
      await supabase.from("transcriptions").update(update).eq("id", action.transcriptionId).eq("user_id", userId);
      await supabase
        .from("drive_file_map")
        .update({ content_hash: computeContentHash(content) })
        .eq("user_id", userId)
        .eq("drive_file_id", action.driveFileId);
      counters.pulled++;
      return;
    }

    case "delete_in_drive": {
      await trashFile(accessToken, action.driveFileId);
      await supabase
        .from("drive_file_map")
        .update({ deleted_at: now })
        .eq("user_id", userId)
        .eq("drive_file_id", action.driveFileId);
      counters.deletedInDrive++;
      return;
    }

    case "delete_local": {
      await supabase
        .from("transcriptions")
        .update({ deleted_at: now })
        .eq("id", action.transcriptionId)
        .eq("user_id", userId);
      await supabase
        .from("drive_file_map")
        .update({ deleted_at: now })
        .eq("user_id", userId)
        .eq("drive_file_id", action.driveFileId);
      counters.deletedLocal++;
      return;
    }

    case "noop":
      return;
  }
}
