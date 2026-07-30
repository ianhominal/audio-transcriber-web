import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadBinaryFile, DriveApiError } from "./api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "./connection";
import { buildProjectDriveFolderMap } from "./scope";
import { driveMimeTypeForAudio, shouldExportAudioToDrive } from "./audio-export";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { AUDIO_BUCKET } from "@/lib/storage";

/**
 * Sube a Drive el audio de una transcripción recién creada, si su proyecto cuelga de una carpeta
 * conectada. Requisito del dueño: una carpeta de Drive conectada sincroniza en los DOS sentidos,
 * audios y transcripciones — hasta ahora un audio creado en la app nunca viajaba a Drive.
 *
 * **Best-effort y silencioso ante fallas**: NUNCA tira. Corre después de que la transcripción ya está
 * guardada y respondida, así que un problema de Drive (token vencido, cuota, red) no puede romper ni
 * demorar una transcripción que al usuario ya le salió bien. Si falla, el audio simplemente no está
 * en Drive todavía; la fila queda sin `drive_audio_file_id` y un intento posterior lo reintenta.
 *
 * El audio se lee de Supabase Storage, no del request: así el tamaño no pasa por el límite del borde
 * de Vercel (~4,5 MB en el body de una función, ver gotcha 17 del CLAUDE.md) y sirve igual para los
 * audios grandes que el desktop sube con `storagePath`.
 */
export async function exportAudioToDriveBestEffort({
  supabase,
  userId,
  transcriptionId,
  projectId,
  storagePath,
  audioName,
  driveAudioFileId,
}: {
  supabase: SupabaseClient;
  userId: string;
  transcriptionId: string;
  projectId: string | null;
  storagePath: string | null;
  audioName: string;
  driveAudioFileId: string | null;
}): Promise<void> {
  try {
    if (!projectId || !storagePath) return;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const tokenKey = process.env.DRIVE_TOKEN_KEY;
    if (!clientId || !clientSecret || !tokenKey) return;

    // 1) ¿El proyecto cuelga de una carpeta conectada? `buildProjectDriveFolderMap` sube por la
    //    cadena de ancestros, así que una SUBcarpeta de una carpeta conectada también cuenta —
    //    exactamente el caso de un audio guardado en un subproyecto importado de Drive.
    const [{ data: projects }, { data: folders }] = await Promise.all([
      supabase.from("projects").select("id, parent_project_id").is("deleted_at", null),
      supabase.from("drive_folders").select("drive_folder_id, local_project_id").eq("user_id", userId),
    ]);

    if (!projects?.length || !folders?.length) return;

    const folderByProject = buildProjectDriveFolderMap(
      (projects as { id: string; parent_project_id: string | null }[]).map((p) => ({
        id: p.id,
        parentProjectId: p.parent_project_id,
      })),
      (folders as { drive_folder_id: string; local_project_id: string }[]).map((f) => ({
        driveFolderId: f.drive_folder_id,
        localProjectId: f.local_project_id,
      }))
    );

    const driveFolderId = folderByProject.get(projectId) ?? null;
    if (!shouldExportAudioToDrive({ driveFolderId, driveAudioFileId, storagePath })) return;

    // 2) Bajar el audio de Storage y subirlo a Drive.
    const { data: blob, error: downloadError } = await supabase.storage.from(AUDIO_BUCKET).download(storagePath);
    if (downloadError || !blob) {
      console.error("[drive/audio-export] no se pudo leer el audio de Storage:", downloadError?.message);
      return;
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const uploaded = await uploadBinaryFile(
      await getUserDriveAccessToken(supabase, userId, { clientId, clientSecret, tokenKey }),
      driveFolderId!,
      audioName,
      driveMimeTypeForAudio(audioName),
      bytes
    );

    // 3) Registrar el id del archivo. Va en `transcriptions.drive_audio_file_id`, NUNCA en
    //    `drive_file_map`: ese mapa habilita la acción `push_update` del motor de sync, que escribe
    //    el Markdown de la nota ENCIMA del archivo mapeado — con el audio ahí, el primer tick del
    //    sync le sobreescribiría la grabación al usuario. Además, guardarlo acá vuelve idempotente
    //    la exportación (ver `shouldExportAudioToDrive`).
    const { error: updateError } = await supabase
      .from("transcriptions")
      .update({ drive_audio_file_id: uploaded.id })
      .eq("id", transcriptionId);

    if (updateError && !isMissingColumnError(updateError)) {
      console.error("[drive/audio-export] no se pudo guardar drive_audio_file_id:", updateError.message);
    }
  } catch (err) {
    // Best-effort de verdad: la transcripción del usuario ya está guardada y respondida.
    if (err instanceof DriveNotConnectedError || err instanceof DriveApiError) {
      console.warn("[drive/audio-export] Drive no disponible:", err.message);
      return;
    }
    console.error("[drive/audio-export] error inesperado:", err);
  }
}
