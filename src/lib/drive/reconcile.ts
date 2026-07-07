/**
 * Reconciliación PURA del motor de sync Drive ↔ nube (Fase 2, doc 09).
 *
 * Estilo "SyncPlanner": dado el estado de la nube (transcripciones), el mapeo `drive_file_map`
 * (fileId de Drive ↔ transcripción, con el hash de contenido de la última sincronización) y los
 * cambios de Drive (`changes.list` de este tick), decide QUÉ acciones hacer — sin tocar la red ni
 * la base de datos. `src/app/api/cron/drive-sync/route.ts` ejecuta las acciones devueltas acá.
 *
 * Reglas (coherentes con doc 07 y doc 09 "Resolución de conflictos"):
 * - Last-write-wins por timestamp (`updatedAt` de la transcripción vs `modifiedTime` de Drive).
 * - Anti-loop/anti-eco: se compara el hash del contenido (md5, mismo algoritmo que
 *   `md5Checksum` de Drive) contra `drive_file_map.content_hash` (el hash de la última vez que
 *   ambos lados quedaron sincronizados). Si no cambió, no se re-procesa aunque el timestamp haya
 *   tocado (ej. el propio push del tick anterior).
 * - Salvaguarda anti-pisada silenciosa: en un conflicto (cambió en los dos lados a la vez), la
 *   acción ganadora se marca `isConflict: true` para que el ejecutor guarde una copia del lado
 *   perdedor antes de pisarlo (no se implementa acá porque requiere leer el contenido perdedor,
 *   que esta capa no tiene — es I/O).
 * - Freno anti-borrado-masivo: si una proporción alta de los archivos mapeados aparece borrada de
 *   golpe (carpeta desmontada, permisos revocados, cursor corrupto), se pausan los `delete_local`
 *   de ese tick (se devuelven como `noop`) y se prende `massDeleteGuardTriggered`.
 */
import { buildMarkdownExport, slugifyFileName } from "@/lib/format";
import { createHash } from "node:crypto";

/** Hash de contenido comparable 1:1 con `md5Checksum` de Drive (mismo algoritmo, mismos bytes UTF-8). */
export function computeContentHash(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

/** Nombre de archivo `.md` que le corresponde a una transcripción en la carpeta raíz de Drive. */
export function driveFileName(title: string): string {
  return `${slugifyFileName(title)}.md`;
}

export type CloudTranscriptionInput = {
  id: string;
  title: string;
  text: string;
  projectName?: string | null;
  createdAt: string; // ISO — va al frontmatter del .md
  updatedAt: string; // ISO — lado "nube" del last-write-wins
  deletedAt: string | null; // soft-delete en la nube
};

export type DriveFileMapEntry = {
  driveFileId: string;
  transcriptionId: string;
  contentHash: string | null; // hash acordado en la última sync exitosa (push o pull)
};

export type DriveChangeInput = {
  fileId: string;
  removed: boolean; // `change.removed` de la Drive API (borrado duro / fuera de alcance del changes feed)
  trashed: boolean; // `change.file.trashed`
  name?: string | null;
  modifiedTime?: string | null; // ISO
  md5Checksum?: string | null;
};

export type ReconcileAction =
  | { type: "push_create"; transcriptionId: string; fileName: string; content: string; contentHash: string }
  | {
      type: "push_update";
      transcriptionId: string;
      driveFileId: string;
      fileName: string;
      content: string;
      contentHash: string;
      isConflict: boolean;
    }
  | {
      type: "pull_update";
      transcriptionId: string;
      driveFileId: string;
      isConflict: boolean;
    }
  | { type: "delete_in_drive"; transcriptionId: string; driveFileId: string }
  | { type: "delete_local"; transcriptionId: string; driveFileId: string }
  | { type: "noop"; transcriptionId?: string; driveFileId?: string; reason: string };

export type ReconcileInput = {
  transcriptions: CloudTranscriptionInput[];
  fileMap: DriveFileMapEntry[];
  driveChanges: DriveChangeInput[];
};

export type ReconcileResult = {
  actions: ReconcileAction[];
  massDeleteGuardTriggered: boolean;
};

/** `a` es estrictamente más nueva que `b`. Fecha faltante/ inválida cuenta como "época 0" (siempre pierde). */
function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const at = a ? Date.parse(a) : NaN;
  const bt = b ? Date.parse(b) : NaN;
  const aVal = Number.isNaN(at) ? 0 : at;
  const bVal = Number.isNaN(bt) ? 0 : bt;
  return aVal > bVal;
}

function exportMarkdown(t: CloudTranscriptionInput): string {
  return buildMarkdownExport({
    title: t.title,
    createdAt: t.createdAt,
    projectName: t.projectName,
    text: t.text,
  });
}

// Umbral del freno anti-borrado-masivo: si se van a borrar más de esta fracción de lo mapeado
// (y al menos MIN_DELETES_FOR_GUARD), se pausa. Evita gatillar con 1-2 borrados normales.
const MASS_DELETE_FRACTION = 0.5;
const MIN_DELETES_FOR_GUARD = 3;

export function reconcileDriveSync(input: ReconcileInput): ReconcileResult {
  const { transcriptions, fileMap, driveChanges } = input;

  const transcriptionsById = new Map(transcriptions.map((t) => [t.id, t]));
  const mapByTranscriptionId = new Map(fileMap.map((m) => [m.transcriptionId, m]));
  const mapByDriveFileId = new Map(fileMap.map((m) => [m.driveFileId, m]));

  // `changes.list` puede traer varias entradas del mismo archivo en un tick (varias ediciones
  // seguidas): nos quedamos con la última (el feed viene en orden cronológico).
  const changesByFileId = new Map<string, DriveChangeInput>();
  for (const change of driveChanges) changesByFileId.set(change.fileId, change);

  const actions: ReconcileAction[] = [];
  const resolvedTranscriptionIds = new Set<string>();

  // ---- Pase 1: cambios que llegaron de Drive (removidos, editados) ----
  for (const change of changesByFileId.values()) {
    const mapEntry = mapByDriveFileId.get(change.fileId);
    if (!mapEntry) {
      // Con scope `drive.file` esto no debería pasar (solo vemos lo que la app creó), pero si
      // ocurre (ej. mapeo borrado a mano) no hay nada local con qué reconciliar.
      actions.push({ type: "noop", driveFileId: change.fileId, reason: "sin_mapeo_local" });
      continue;
    }

    const t = transcriptionsById.get(mapEntry.transcriptionId);
    if (!t) {
      actions.push({
        type: "noop",
        driveFileId: change.fileId,
        transcriptionId: mapEntry.transcriptionId,
        reason: "transcripcion_no_encontrada",
      });
      continue;
    }

    const removedOrTrashed = change.removed || change.trashed;
    const localHash = computeContentHash(exportMarkdown(t));
    const changedLocally = mapEntry.contentHash !== localHash;
    const changedRemotely = !removedOrTrashed && !!change.md5Checksum && change.md5Checksum !== mapEntry.contentHash;

    if (removedOrTrashed) {
      if (t.deletedAt) {
        // Ya borrado de los dos lados: idempotente, el ejecutor solo confirma el tombstone del map.
        actions.push({ type: "delete_local", transcriptionId: t.id, driveFileId: change.fileId });
        resolvedTranscriptionIds.add(t.id);
        continue;
      }
      if (changedLocally) {
        // Conflicto: se editó localmente y Drive dice "borrado". Protegemos la edición: se
        // recrea/actualiza en Drive en vez de perderla, salvo que el borrado sea más nuevo.
        const localWins = isNewer(t.updatedAt, change.modifiedTime);
        if (localWins) {
          actions.push({
            type: "push_update",
            transcriptionId: t.id,
            driveFileId: change.fileId,
            fileName: driveFileName(t.title),
            content: exportMarkdown(t),
            contentHash: localHash,
            isConflict: true,
          });
        } else {
          actions.push({ type: "delete_local", transcriptionId: t.id, driveFileId: change.fileId });
        }
        resolvedTranscriptionIds.add(t.id);
        continue;
      }
      // Borrado limpio en Drive, sin cambios locales pendientes: se propaga.
      actions.push({ type: "delete_local", transcriptionId: t.id, driveFileId: change.fileId });
      resolvedTranscriptionIds.add(t.id);
      continue;
    }

    if (changedRemotely) {
      if (t.deletedAt) {
        // Se borró localmente pero Drive tiene una edición más nueva: gana la edición (se
        // recupera de la papelera implícitamente al traer el contenido) o gana el borrado.
        const remoteWins = isNewer(change.modifiedTime, t.updatedAt);
        if (remoteWins) {
          actions.push({ type: "pull_update", transcriptionId: t.id, driveFileId: change.fileId, isConflict: true });
        } else {
          actions.push({ type: "delete_in_drive", transcriptionId: t.id, driveFileId: change.fileId });
        }
        resolvedTranscriptionIds.add(t.id);
        continue;
      }
      if (changedLocally) {
        // Conflicto real: cambió en los dos lados desde la última sync.
        const localWins = isNewer(t.updatedAt, change.modifiedTime);
        if (localWins) {
          actions.push({
            type: "push_update",
            transcriptionId: t.id,
            driveFileId: change.fileId,
            fileName: driveFileName(t.title),
            content: exportMarkdown(t),
            contentHash: localHash,
            isConflict: true,
          });
        } else {
          actions.push({ type: "pull_update", transcriptionId: t.id, driveFileId: change.fileId, isConflict: true });
        }
        resolvedTranscriptionIds.add(t.id);
        continue;
      }
      // Solo cambió en Drive: pull limpio (incluye renombres — el ejecutor lee `change.name`).
      actions.push({ type: "pull_update", transcriptionId: t.id, driveFileId: change.fileId, isConflict: false });
      resolvedTranscriptionIds.add(t.id);
      continue;
    }

    // El archivo aparece en cambios pero el contenido (md5) es el mismo que ya teníamos
    // sincronizado: anti-eco (típicamente el propio push de un tick anterior tocando modifiedTime).
    actions.push({ type: "noop", transcriptionId: t.id, driveFileId: change.fileId, reason: "sin_cambio_real" });
    resolvedTranscriptionIds.add(t.id);
  }

  // ---- Pase 2: transcripciones de la nube no resueltas por el pase 1 ----
  for (const t of transcriptions) {
    if (resolvedTranscriptionIds.has(t.id)) continue;

    const mapEntry = mapByTranscriptionId.get(t.id);

    if (!mapEntry) {
      if (t.deletedAt) continue; // nunca se sincronizó y ya está borrada: nada que hacer
      const content = exportMarkdown(t);
      actions.push({
        type: "push_create",
        transcriptionId: t.id,
        fileName: driveFileName(t.title),
        content,
        contentHash: computeContentHash(content),
      });
      continue;
    }

    if (t.deletedAt) {
      actions.push({ type: "delete_in_drive", transcriptionId: t.id, driveFileId: mapEntry.driveFileId });
      continue;
    }

    const content = exportMarkdown(t);
    const localHash = computeContentHash(content);
    if (localHash !== mapEntry.contentHash) {
      actions.push({
        type: "push_update",
        transcriptionId: t.id,
        driveFileId: mapEntry.driveFileId,
        fileName: driveFileName(t.title),
        content,
        contentHash: localHash,
        isConflict: false,
      });
      continue;
    }

    actions.push({ type: "noop", transcriptionId: t.id, driveFileId: mapEntry.driveFileId, reason: "en_sync" });
  }

  // ---- Freno anti-borrado-masivo ----
  const activeMapCount = fileMap.length;
  const deleteLocalCount = actions.filter((a) => a.type === "delete_local").length;
  const massDeleteGuardTriggered =
    activeMapCount > 0 &&
    deleteLocalCount >= MIN_DELETES_FOR_GUARD &&
    deleteLocalCount / activeMapCount > MASS_DELETE_FRACTION;

  const finalActions = massDeleteGuardTriggered
    ? actions.map((a) =>
        a.type === "delete_local"
          ? ({
              type: "noop",
              transcriptionId: a.transcriptionId,
              driveFileId: a.driveFileId,
              reason: "freno_borrado_masivo",
            } satisfies ReconcileAction)
          : a
      )
    : actions;

  return { actions: finalActions, massDeleteGuardTriggered };
}
