import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { decryptSecret } from "@/lib/crypto";
import { bearerSecretFromHeader, isAuthorizedCronSecret } from "@/lib/cronAuth";
import {
  getAccessToken,
  getStartPageToken,
  listChanges,
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
import { computeDriveScopeProjectIds, buildProjectDriveFolderMap, type ProjectLite } from "@/lib/drive/scope";
import { parseMarkdownExport } from "@/lib/format";

export const runtime = "nodejs";

/**
 * Motor de sync Drive ↔ nube (doc 09 Fase 2, ACOTADO por doc 10). Corre "como sistema" (sin
 * usuario logueado), igual que `api/cron/purge`: usa el service-role client (bypassea RLS a
 * propósito) para recorrer TODAS las conexiones de Drive, no solo la de quien dispara el request.
 *
 * ACOTADO (doc 10): a diferencia de la Fase 2 original, este motor YA NO sincroniza todos los
 * proyectos del usuario — solo los que cuelgan de una `drive_folders` (proyecto raíz conectado a
 * una carpeta de Drive) o de su subárbol vía `projects.parent_project_id`. Un usuario sin ninguna
 * fila en `drive_folders` no sube/baja nada (todavía no hay UI para conectar una carpeta — eso es
 * la fase siguiente — así que hoy el alcance en producción es efectivamente vacío a propósito).
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
    .select("user_id, refresh_token_encrypted, start_page_token");

  if (connError) {
    // Superficie el error REAL de Supabase (no un mensaje genérico): esto es lo que permite
    // diagnosticar en el momento si la causa es una service-role key mal configurada (ej. una
    // "secret key" `sb_secret_...` que el gateway rechaza por venir también en el header
    // `Authorization: Bearer` como si fuera un JWT), RLS bloqueando la lectura, o un problema
    // de schema/columnas. Mismo criterio que ya usa `api/sync/push` con `error.message`.
    console.error("[cron/drive-sync] error leyendo drive_connections:", connError);
    return NextResponse.json(
      {
        error: "No se pudieron leer las conexiones de Drive.",
        details: connError.message,
        code: connError.code,
        hint: connError.hint,
      },
      { status: 500 }
    );
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

type ProjectRow = {
  id: string;
  name: string;
  parent_project_id: string | null;
};

type DriveFolderRow = {
  drive_folder_id: string;
  local_project_id: string;
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
  const emptyCounters = { pushed: 0, pulled: 0, deletedInDrive: 0, deletedLocal: 0, conflicts: 0 };

  // ---- 0. ACOTADO (doc 10): sin ninguna carpeta de Drive conectada, no hay nada que
  // sincronizar. Se chequea ANTES de renovar el access token para no gastar cuota/tiempo en un
  // usuario que todavía no conectó ninguna carpeta (hoy no hay UI para eso — fase siguiente —
  // así que en producción esto hace que el tick sea, a propósito, un no-op para todos).
  const { data: driveFoldersRaw } = await supabase
    .from("drive_folders")
    .select("drive_folder_id, local_project_id")
    .eq("user_id", conn.user_id);
  const driveFolders = (driveFoldersRaw ?? []) as DriveFolderRow[];
  if (driveFolders.length === 0) {
    return { ...emptyCounters, massDeleteGuardTriggered: false };
  }

  const refreshToken = decryptSecret(conn.refresh_token_encrypted, config.tokenKey);
  const accessToken = await getAccessToken(refreshToken, config.clientId, config.clientSecret);

  // ---- Setup on-demand: baseline del cursor, si es la primera corrida. El cursor de
  // `changes.list` es por CUENTA de Google (no por carpeta) — se mantiene a nivel conexión,
  // nunca por `drive_folders` (ver doc 10).
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

  // ---- 2. Proyectos del usuario: resuelven la jerarquía y el ACOTADO (doc 10) ----
  const { data: projectsRaw } = await supabase
    .from("projects")
    .select("id, name, parent_project_id")
    .eq("user_id", conn.user_id);
  const projectRows = (projectsRaw ?? []) as ProjectRow[];
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));
  const projectsLite: ProjectLite[] = projectRows.map((p) => ({ id: p.id, parentProjectId: p.parent_project_id }));

  // Conjunto de proyectos "bajo Drive": las raíces conectadas (`drive_folders`) + su subárbol
  // completo vía `parent_project_id`. Todo lo que NO está acá queda fuera del sync (ACOTADO).
  const scopeProjectIds = computeDriveScopeProjectIds(
    projectsLite,
    driveFolders.map((f) => f.local_project_id)
  );

  // A qué carpeta de Drive van los archivos de cada proyecto en alcance: la SUYA propia si ya
  // tiene una subcarpeta real importada/creada (`drive_file_map` kind='project'), o si no la del
  // ancestro conectado más cercano (`drive_folders`). Desde que existe la importación jerárquica
  // (doc 10, fase de importación recursiva) los subproyectos SÍ tienen su propia carpeta en Drive
  // — antes de eso todo el subárbol resolvía, a propósito, a la carpeta raíz (comentario viejo de
  // este archivo). `buildProjectDriveFolderMap` ya prioriza el propio id del proyecto sobre subir
  // a un ancestro (ver `src/lib/drive/scope.ts`), así que alcanza con pasarle la unión de ambas
  // fuentes — no hace falta tocar esa función pura.
  const { data: projectFolderMapRaw } = await supabase
    .from("drive_file_map")
    .select("drive_file_id, local_id")
    .eq("user_id", conn.user_id)
    .eq("kind", "project")
    .is("deleted_at", null);
  const projectFolderMapRows = (projectFolderMapRaw ?? []) as { drive_file_id: string; local_id: string }[];

  const projectDriveFolderMap = buildProjectDriveFolderMap(projectsLite, [
    ...driveFolders.map((f) => ({ driveFolderId: f.drive_folder_id, localProjectId: f.local_project_id })),
    ...projectFolderMapRows.map((m) => ({ driveFolderId: m.drive_file_id, localProjectId: m.local_id })),
  ]);

  // ---- 3. Transcripciones del usuario, ACOTADAS a proyectos dentro del árbol de Drive ----
  const { data: transcriptionsRaw } = await supabase
    .from("transcriptions")
    .select("id, title, audio_name, text, project_id, created_at, updated_at, deleted_at")
    .eq("user_id", conn.user_id);
  const transcriptionRows = ((transcriptionsRaw ?? []) as TranscriptionRow[]).filter(
    (t) => t.project_id !== null && scopeProjectIds.has(t.project_id)
  );
  const transcriptionRowById = new Map(transcriptionRows.map((t) => [t.id, t]));

  const transcriptions: CloudTranscriptionInput[] = transcriptionRows.map((t) => ({
    id: t.id,
    title: displayTitle(t),
    text: t.text ?? "",
    projectName: t.project_id ? (projectNameById.get(t.project_id) ?? null) : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at,
  }));

  // ---- 4. Mapeo Drive ↔ transcripción, ACOTADO a las mismas transcripciones en alcance (una
  // transcripción que quedó fuera del árbol de Drive -ej. se movió de proyecto- deja de
  // reconciliarse aunque tenga un mapeo viejo; el archivo en Drive queda huérfano en vez de
  // seguir tocándose, coherente con "solo lo que cuelga de Drive se sincroniza"). ----
  const { data: mapRowsRaw } = await supabase
    .from("drive_file_map")
    .select("drive_file_id, local_id, content_hash")
    .eq("user_id", conn.user_id)
    .eq("kind", "transcription")
    .is("deleted_at", null);
  const fileMap: DriveFileMapEntry[] = (
    (mapRowsRaw ?? []) as { drive_file_id: string; local_id: string; content_hash: string | null }[]
  )
    .filter((m) => transcriptionRowById.has(m.local_id))
    .map((m) => ({
      driveFileId: m.drive_file_id,
      transcriptionId: m.local_id,
      contentHash: m.content_hash,
    }));

  // ---- 5. Reconciliar (función pura, sin I/O) ----
  const { actions, massDeleteGuardTriggered } = reconcileDriveSync({ transcriptions, fileMap, driveChanges });

  // ---- 6. Ejecutar las acciones contra Drive + Supabase ----
  const now = new Date().toISOString();
  const counters = { ...emptyCounters };

  for (const action of actions) {
    await applyAction(supabase, accessToken, conn.user_id, projectDriveFolderMap, transcriptionRowById, action, now, counters);
  }

  // ---- 7. Avanzar el cursor (por conexión, no por carpeta — ver doc 10) ----
  await supabase
    .from("drive_connections")
    .update({ start_page_token: newStartPageToken, updated_at: now })
    .eq("user_id", conn.user_id);

  return { ...counters, massDeleteGuardTriggered };
}

type Counters = { pushed: number; pulled: number; deletedInDrive: number; deletedLocal: number; conflicts: number };

/**
 * Carpeta de Drive donde debe vivir el archivo de una transcripción: la del proyecto al que
 * pertenece (resuelto por `buildProjectDriveFolderMap`, ya sabe subir por la jerarquía hasta la
 * raíz conectada). `null` si el proyecto no tiene carpeta resuelta — no debería pasar (la
 * transcripción ya llegó filtrada por `scopeProjectIds`), pero es defensivo ante datos corridos
 * entre el filtro y la ejecución (ej. el proyecto se borró/desconectó a mitad del tick).
 */
function resolveDriveFolderId(
  transcriptionId: string,
  transcriptionRowById: Map<string, TranscriptionRow>,
  projectDriveFolderMap: Map<string, string>
): string | null {
  const projectId = transcriptionRowById.get(transcriptionId)?.project_id;
  if (!projectId) return null;
  return projectDriveFolderMap.get(projectId) ?? null;
}

async function applyAction(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  projectDriveFolderMap: Map<string, string>,
  transcriptionRowById: Map<string, TranscriptionRow>,
  action: ReconcileAction,
  now: string,
  counters: Counters
): Promise<void> {
  switch (action.type) {
    case "push_create": {
      const driveFolderId = resolveDriveFolderId(action.transcriptionId, transcriptionRowById, projectDriveFolderMap);
      if (!driveFolderId) {
        console.error(`[cron/drive-sync] sin carpeta de Drive resuelta para la transcripción ${action.transcriptionId}, se omite.`);
        return;
      }
      const created = await uploadFile(accessToken, driveFolderId, action.fileName, "text/markdown", action.content);
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
        const driveFolderId = resolveDriveFolderId(action.transcriptionId, transcriptionRowById, projectDriveFolderMap);
        try {
          if (!driveFolderId) throw new Error("sin carpeta de Drive resuelta para guardar la copia de conflicto");
          const losing = await getFileContent(accessToken, action.driveFileId);
          await uploadFile(accessToken, driveFolderId, conflictFileName(action.fileName), "text/markdown", losing);
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
