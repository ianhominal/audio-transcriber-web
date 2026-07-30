import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getApiUser } from "@/lib/supabase/api";
import { getFileContent, fetchDriveFolderTree, DriveApiError } from "@/lib/drive/api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "@/lib/drive/connection";
import { planDriveImport, type DriveImportPlan } from "@/lib/drive/tree";
import { computeContentHash } from "@/lib/drive/reconcile";
import { parseMarkdownExport, validateProjectName } from "@/lib/format";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { resolveRootProjectAction } from "@/lib/drive/connect-root";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Tope de anidamiento (doc 10, decisión #5): evita árboles patológicos y protege contra un
// eventual ciclo de carpetas compartidas cruzadas — ver anti-ciclo también en `fetchDriveFolderTree`.
const MAX_IMPORT_DEPTH = 20;

type ConnectBody = { driveFolderId?: unknown; name?: unknown };

/**
 * Deja solo las filas de `drive_file_map` cuyo destino local SIGUE EXISTIENDO (no borrado).
 *
 * `drive_file_map` no tiene borrado en cascada desde `projects`/`transcriptions`, así que después de
 * borrar un proyecto quedan filas apuntando a la nada. `planDriveImport` las lee como "esto ya está
 * importado" y saltea justamente lo que habría que volver a traer: reconectar la carpeta terminaba
 * importando CERO. Consultar las tablas reales cuesta dos queries y evita todo un árbol fantasma.
 */
async function filterMapRowsWithLiveTargets(
  supabase: SupabaseClient,
  rows: DriveFileMapRow[]
): Promise<DriveFileMapRow[]> {
  if (rows.length === 0) return rows;

  const projectIds = rows.filter((r) => r.kind === "project").map((r) => r.local_id);
  const transcriptionIds = rows.filter((r) => r.kind === "transcription").map((r) => r.local_id);

  const [liveProjects, liveTranscriptions] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id").in("id", projectIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as { id: string }[] }),
    transcriptionIds.length
      ? supabase.from("transcriptions").select("id").in("id", transcriptionIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const alive = new Set([
    ...((liveProjects.data ?? []) as { id: string }[]).map((p) => p.id),
    ...((liveTranscriptions.data ?? []) as { id: string }[]).map((t) => t.id),
  ]);

  return rows.filter((r) => alive.has(r.local_id));
}

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
    //
    // El mapeo se valida contra el proyecto REAL antes de reusarlo. Reporte real: conectar una
    // carpeta respondía 200 y no aparecía nada en la lista ni refrescando — la fila de
    // `drive_folders` seguía apuntando a un proyecto BORRADO en una prueba anterior, así que la
    // importación entera caía dentro de un proyecto que estaba en la papelera. Un mapeo que apunta a
    // la nada no es una reconexión: es un mapeo roto, y hay que rehacerlo (ver `resolveRootProjectAction`).
    const { data: existingRoot } = await supabase
      .from("drive_folders")
      .select("local_project_id")
      .eq("user_id", user.id)
      .eq("drive_folder_id", driveFolderId)
      .maybeSingle();

    const mappedProjectId = (existingRoot?.local_project_id as string | undefined) ?? null;
    let mappedProjectIsAlive = false;
    if (mappedProjectId) {
      const { data: mappedProject } = await supabase
        .from("projects")
        .select("id")
        .eq("id", mappedProjectId)
        .is("deleted_at", null)
        .maybeSingle();
      mappedProjectIsAlive = !!mappedProject;
    }

    const rootAction = resolveRootProjectAction({ mappedProjectId, mappedProjectIsAlive });

    let rootProjectId: string;
    if (rootAction.action === "reuse") {
      rootProjectId = rootAction.projectId;
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

      if (rootAction.action === "recreate") {
        // Repuntar el mapeo huérfano en vez de insertar uno nuevo: `drive_folders` ya tiene una fila
        // para esta carpeta, y un INSERT chocaría con la unicidad (user_id, drive_folder_id).
        console.warn("[drive/folders/connect] mapeo huérfano, se recrea el proyecto raíz", {
          userId: user.id,
          driveFolderId,
          staleProjectId: rootAction.staleProjectId,
        });
        const { error: repointError } = await supabase
          .from("drive_folders")
          .update({ local_project_id: rootProjectId, name: folderName })
          .eq("user_id", user.id)
          .eq("drive_folder_id", driveFolderId);
        if (repointError) {
          console.error("[drive/folders/connect] error repuntando drive_folders:", repointError.message);
          return NextResponse.json({ error: "No se pudo registrar la conexión de la carpeta." }, { status: 500 });
        }

      } else {
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
    }

    // ---- 2. Lo que ya está mapeado (reconexión / importación parcial anterior) ----
    const { data: mapRowsRaw } = await supabase
      .from("drive_file_map")
      .select("drive_file_id, kind, local_id")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    const allMapRows = (mapRowsRaw ?? []) as DriveFileMapRow[];

    // Un mapeo que apunta a algo BORRADO no cuenta como "ya importado". Sin este filtro, después de
    // borrar un proyecto de Drive el mapa seguía diciendo que sus carpetas y notas estaban
    // importadas, así que reconectar la carpeta no traía NADA — mismo síntoma que el mapeo huérfano
    // de la raíz (bloque 1), con otra cara. Se verifica contra las tablas reales en vez de confiar
    // en el mapa.
    const mapRows = await filterMapRowsWithLiveTargets(supabase, allMapRows);

    const existingFolderIds = new Set(mapRows.filter((m) => m.kind === "project").map((m) => m.drive_file_id));
    const existingFileIds = new Set(mapRows.filter((m) => m.kind === "transcription").map((m) => m.drive_file_id));

    // Audios ya importados. Van aparte del `drive_file_map` a propósito (ver el bloque 4b), así que
    // la idempotencia de los audios se resuelve leyendo la columna `drive_audio_file_id` — si no,
    // reconectar la carpeta duplicaría cada grabación. `isMissingColumnError` cubre la ventana de
    // rollout de la migración: sin la columna se sigue sin idempotencia de audios (y el insert de
    // más abajo también va a fallar, así que no se duplica nada igual).
    const { data: audioRows, error: audioRowsError } = await supabase
      .from("transcriptions")
      .select("drive_audio_file_id")
      .eq("user_id", user.id)
      .not("drive_audio_file_id", "is", null);
    if (audioRowsError && !isMissingColumnError(audioRowsError)) {
      console.error("[drive/folders/connect] error leyendo audios ya importados:", audioRowsError.message);
    }
    for (const row of (audioRows ?? []) as { drive_audio_file_id: string | null }[]) {
      if (row.drive_audio_file_id) existingFileIds.add(row.drive_audio_file_id);
    }

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

    // ---- 4b. Audios: se crean como transcripciones PENDIENTES (sin texto) que apuntan al archivo
    //      de Drive por `drive_audio_file_id`. NO se baja el binario acá: 14 audios no entran en el
    //      `maxDuration = 60` de esta ruta, y transcribirlos consume cuota de Groq — es una acción
    //      aparte y explícita (`/api/drive/transcribe`).
    //
    //      CRÍTICO: estas filas NO van a `drive_file_map`. Ese mapa habilita la acción `push_update`
    //      de `reconcileDriveSync`, que escribe el Markdown de la nota ENCIMA del archivo de Drive
    //      mapeado — con el .m4a ahí, el primer sync le sobrescribiría el audio original al usuario.
    //      Al quedar fuera del mapa, el motor de sync no puede tocar el audio, y la transcripción
    //      (sin mapeo) se exporta luego como un .md NUEVO al lado del audio, que es lo que se quiere.
    let importedAudios = 0;
    let failedAudios = 0;

    for (const step of plan.audiosToImport) {
      const parentLocalId = localProjectIdByDriveFolderId.get(step.parentDriveFolderId);
      if (!parentLocalId) {
        failedAudios++;
        continue;
      }

      const { error } = await supabase.from("transcriptions").insert({
        user_id: user.id,
        project_id: parentLocalId,
        title: step.name.replace(/\.[^.]+$/, ""),
        audio_name: step.name,
        text: "",
        drive_audio_file_id: step.driveFileId,
      });
      if (error) {
        // `drive_audio_file_id` es una columna NUEVA (ver migración 20260730120000): durante la
        // ventana de rollout puede no existir todavía en el esquema real. Mismo criterio de
        // degradación que el resto del repo (`schema-compat.ts`): el resto de la importación —
        // subcarpetas y notas .md — ya se completó y no se tira abajo por esto.
        console.error(`[drive/folders/connect] error importando audio ${step.name}:`, error.message);
        failedAudios++;
        continue;
      }
      importedAudios++;
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
      imported: { projects: createdProjects, transcriptions: importedTranscriptions, audios: importedAudios },
      skipped: {
        existingFolders: plan.skippedExistingFolders,
        existingFiles: plan.skippedExistingFiles,
        otherFiles: plan.skippedOtherFiles,
      },
      failed: { projects: failedProjects, transcriptions: failedTranscriptions, audios: failedAudios },
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
