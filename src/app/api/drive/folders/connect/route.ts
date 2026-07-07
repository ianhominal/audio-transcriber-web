import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getApiUser } from "@/lib/supabase/api";
import { getFileContent, fetchDriveFolderTree, DriveApiError } from "@/lib/drive/api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "@/lib/drive/connection";
import { planDriveImport, type DriveImportPlan } from "@/lib/drive/tree";
import { computeContentHash } from "@/lib/drive/reconcile";
import { parseMarkdownExport, validateProjectName } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 60;

// Tope de anidamiento (doc 10, decisión #5): evita árboles patológicos y protege contra un
// eventual ciclo de carpetas compartidas cruzadas — ver anti-ciclo también en `fetchDriveFolderTree`.
const MAX_IMPORT_DEPTH = 20;

type ConnectBody = { driveFolderId?: unknown; name?: unknown };

type DriveFileMapRow = { drive_file_id: string; kind: "project" | "transcription"; local_id: string };
type NewMapRow = {
  user_id: string;
  drive_file_id: string;
  kind: "project" | "transcription";
  local_id: string;
  content_hash?: string;
  deleted_at: null;
};

/**
 * Conecta una carpeta EXISTENTE de Drive como proyecto raíz e importa RECURSIVAMENTE toda su
 * jerarquía: cada subcarpeta se materializa como subproyecto (`parent_project_id`) y cada `.md`
 * como transcripción (doc 10). Idempotente: correr esto dos veces sobre la misma carpeta no
 * duplica nada — lo ya mapeado en `drive_file_map` se detecta y se saltea (ver `planDriveImport`
 * en `src/lib/drive/tree.ts`, la parte PURA de esta lógica).
 *
 * Best-effort por nodo: si un archivo/carpeta puntual falla (permisos raros, contenido corrupto),
 * se loguea y se sigue con el resto — no aborta toda la importación por un nodo problemático.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) {
    return NextResponse.json({ error: "Falta configuración de Drive en el servidor." }, { status: 500 });
  }

  const body: ConnectBody = await req.json().catch(() => ({}) as ConnectBody);
  const driveFolderId = typeof body.driveFolderId === "string" ? body.driveFolderId.trim() : "";
  if (!driveFolderId) {
    return NextResponse.json({ error: "Falta driveFolderId." }, { status: 400 });
  }
  const parsedName = validateProjectName(typeof body.name === "string" ? body.name : "");
  if (!parsedName.ok) {
    return NextResponse.json({ error: parsedName.error }, { status: 400 });
  }
  const folderName = parsedName.value;

  try {
    const accessToken = await getUserDriveAccessToken(supabase, user.id, { clientId, clientSecret, tokenKey });

    // ---- 1. Raíz: reusar si ya estaba conectada (reconexión idempotente) o crearla ----
    const { data: existingRoot } = await supabase
      .from("drive_folders")
      .select("local_project_id")
      .eq("user_id", user.id)
      .eq("drive_folder_id", driveFolderId)
      .maybeSingle();

    let rootProjectId: string;
    if (existingRoot?.local_project_id) {
      rootProjectId = existingRoot.local_project_id as string;
    } else {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name: folderName, title: folderName, icon: "☁️", sync_origin: "drive" })
        .select("id")
        .single();
      if (projectError || !project) {
        console.error("[drive/folders/connect] error creando proyecto raíz:", projectError?.message);
        return NextResponse.json({ error: "No se pudo crear el proyecto para la carpeta." }, { status: 500 });
      }
      rootProjectId = project.id as string;

      const { error: folderError } = await supabase.from("drive_folders").insert({
        user_id: user.id,
        drive_folder_id: driveFolderId,
        local_project_id: rootProjectId,
        name: folderName,
      });
      if (folderError) {
        console.error("[drive/folders/connect] error guardando drive_folders:", folderError.message);
        return NextResponse.json({ error: "No se pudo registrar la conexión de la carpeta." }, { status: 500 });
      }
    }

    // ---- 2. Lo que ya está mapeado (reconexión / importación parcial anterior) ----
    const { data: mapRowsRaw } = await supabase
      .from("drive_file_map")
      .select("drive_file_id, kind, local_id")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    const mapRows = (mapRowsRaw ?? []) as DriveFileMapRow[];

    const existingFolderIds = new Set(mapRows.filter((m) => m.kind === "project").map((m) => m.drive_file_id));
    const existingFileIds = new Set(mapRows.filter((m) => m.kind === "transcription").map((m) => m.drive_file_id));

    const localProjectIdByDriveFolderId = new Map<string, string>();
    localProjectIdByDriveFolderId.set(driveFolderId, rootProjectId);
    for (const m of mapRows) {
      if (m.kind === "project") localProjectIdByDriveFolderId.set(m.drive_file_id, m.local_id);
    }

    // ---- 3. Traer el árbol completo de Drive y planear qué crear (I/O, luego lógica pura) ----
    const tree = await fetchDriveFolderTree(accessToken, driveFolderId, folderName, { maxDepth: MAX_IMPORT_DEPTH });
    const plan: DriveImportPlan = planDriveImport(tree, {
      existingFolderIds,
      existingFileIds,
      maxDepth: MAX_IMPORT_DEPTH,
    });

    // ---- 4. Ejecutar el plan: subproyectos primero (padre-primero, ya viene en ese orden) ----
    const newMapRows: NewMapRow[] = [];
    let createdProjects = 0;
    let failedProjects = 0;

    for (const step of plan.projectsToCreate) {
      const parentLocalId = localProjectIdByDriveFolderId.get(step.parentDriveFolderId);
      if (!parentLocalId) {
        // No debería pasar (el plan viene en orden padre-primero), pero si el padre falló antes,
        // no tiene sentido intentar crear el hijo con un padre inexistente.
        failedProjects++;
        continue;
      }
      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: step.name,
          title: step.name,
          icon: "",
          sync_origin: "drive",
          parent_project_id: parentLocalId,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error(`[drive/folders/connect] error creando subproyecto para carpeta ${step.driveFolderId}:`, error?.message);
        failedProjects++;
        continue;
      }
      localProjectIdByDriveFolderId.set(step.driveFolderId, data.id as string);
      newMapRows.push({ user_id: user.id, drive_file_id: step.driveFolderId, kind: "project", local_id: data.id as string, deleted_at: null });
      createdProjects++;
    }

    let importedTranscriptions = 0;
    let failedTranscriptions = 0;

    for (const step of plan.transcriptionsToCreate) {
      const parentLocalId = localProjectIdByDriveFolderId.get(step.parentDriveFolderId);
      if (!parentLocalId) {
        failedTranscriptions++;
        continue;
      }

      let content: string;
      try {
        content = await getFileContent(accessToken, step.driveFileId);
      } catch (err) {
        console.error(`[drive/folders/connect] error bajando ${step.name} (${step.driveFileId}):`, err);
        failedTranscriptions++;
        continue;
      }

      const parsed = parseMarkdownExport(content);
      const { data, error } = await supabase
        .from("transcriptions")
        .insert({
          user_id: user.id,
          project_id: parentLocalId,
          title: parsed.title || step.name.replace(/\.md$/i, ""),
          audio_name: step.name,
          text: parsed.text,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error(`[drive/folders/connect] error creando transcripción para ${step.name}:`, error?.message);
        failedTranscriptions++;
        continue;
      }
      newMapRows.push({
        user_id: user.id,
        drive_file_id: step.driveFileId,
        kind: "transcription",
        local_id: data.id as string,
        content_hash: computeContentHash(content),
        deleted_at: null,
      });
      importedTranscriptions++;
    }

    if (newMapRows.length > 0) {
      const { error: mapError } = await supabase
        .from("drive_file_map")
        .upsert(newMapRows, { onConflict: "user_id,drive_file_id" });
      if (mapError) {
        console.error("[drive/folders/connect] error guardando drive_file_map:", mapError.message);
      }
    }

    revalidatePath("/app");
    revalidatePath("/app/ajustes");

    return NextResponse.json({
      ok: true,
      projectId: rootProjectId,
      imported: { projects: createdProjects, transcriptions: importedTranscriptions },
      skipped: {
        existingFolders: plan.skippedExistingFolders,
        existingFiles: plan.skippedExistingFiles,
        otherFiles: plan.skippedOtherFiles,
      },
      failed: { projects: failedProjects, transcriptions: failedTranscriptions },
      depthTruncated: plan.depthTruncated,
    });
  } catch (err) {
    if (err instanceof DriveNotConnectedError) {
      return NextResponse.json({ error: err.message, code: "not-connected" }, { status: 400 });
    }
    if (err instanceof DriveApiError) {
      const needsReauth = err.code === "invalid_grant";
      return NextResponse.json(
        { error: err.message, code: needsReauth ? "needs-reauth" : (err.code ?? "drive-error") },
        { status: err.status ?? 502 }
      );
    }
    console.error("[drive/folders/connect] error inesperado:", err);
    return NextResponse.json({ error: "No se pudo conectar la carpeta de Drive." }, { status: 500 });
  }
}
