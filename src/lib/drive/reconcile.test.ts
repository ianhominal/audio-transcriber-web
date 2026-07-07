import { describe, it, expect } from "vitest";
import { buildMarkdownExport } from "@/lib/format";
import {
  reconcileDriveSync,
  computeContentHash,
  driveFileName,
  type CloudTranscriptionInput,
  type DriveFileMapEntry,
  type DriveChangeInput,
} from "./reconcile";

const OLD = "2026-07-01T10:00:00Z";
const NEWER = "2026-07-05T10:00:00Z";
const NEWEST = "2026-07-06T10:00:00Z";

function transcription(overrides: Partial<CloudTranscriptionInput> = {}): CloudTranscriptionInput {
  return {
    id: "t1",
    title: "Reunión de equipo",
    text: "Contenido original.",
    projectName: null,
    createdAt: OLD,
    updatedAt: OLD,
    deletedAt: null,
    ...overrides,
  };
}

/** Hash "en sync" para una transcripción: lo que quedaría guardado en `drive_file_map` justo después de sincronizarla. */
function syncedHash(t: CloudTranscriptionInput): string {
  return computeContentHash(buildMarkdownExport({ title: t.title, createdAt: t.createdAt, projectName: t.projectName, text: t.text }));
}

function mapEntry(t: CloudTranscriptionInput, overrides: Partial<DriveFileMapEntry> = {}): DriveFileMapEntry {
  return { driveFileId: "drive-1", transcriptionId: t.id, contentHash: syncedHash(t), ...overrides };
}

describe("reconcileDriveSync — transcripción nueva (push_create)", () => {
  it("propone push_create para una transcripción sin mapeo y sin borrar", () => {
    const t = transcription();
    const { actions, massDeleteGuardTriggered } = reconcileDriveSync({
      transcriptions: [t],
      fileMap: [],
      driveChanges: [],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "push_create",
      transcriptionId: "t1",
      fileName: driveFileName(t.title),
    });
    expect(massDeleteGuardTriggered).toBe(false);
  });

  it("no propone nada para una transcripción borrada que nunca se sincronizó", () => {
    const t = transcription({ deletedAt: NEWER });
    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [], driveChanges: [] });
    expect(actions).toHaveLength(0);
  });
});

describe("reconcileDriveSync — sin cambios (anti-eco)", () => {
  it("no hace nada si el hash local coincide con el del mapeo y no hay cambios de Drive", () => {
    const t = transcription();
    const map = mapEntry(t);
    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [] });
    expect(actions).toEqual([{ type: "noop", transcriptionId: "t1", driveFileId: "drive-1", reason: "en_sync" }]);
  });

  it("no re-procesa un cambio de Drive cuyo md5 coincide con el mapeo (eco del propio push)", () => {
    const t = transcription();
    const map = mapEntry(t);
    const change: DriveChangeInput = {
      fileId: "drive-1",
      removed: false,
      trashed: false,
      modifiedTime: NEWEST,
      md5Checksum: map.contentHash, // mismo contenido: el modifiedTime tocó pero el md5 no cambió
    };
    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [change] });
    expect(actions).toEqual([{ type: "noop", transcriptionId: "t1", driveFileId: "drive-1", reason: "sin_cambio_real" }]);
  });
});

describe("reconcileDriveSync — cambio local (push_update)", () => {
  it("propone push_update cuando el texto local cambió desde la última sync", () => {
    const synced = transcription();
    const map = mapEntry(synced);
    const edited = transcription({ text: "Contenido editado en la app.", updatedAt: NEWER });

    const { actions } = reconcileDriveSync({ transcriptions: [edited], fileMap: [map], driveChanges: [] });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "push_update",
      transcriptionId: "t1",
      driveFileId: "drive-1",
      isConflict: false,
    });
  });
});

describe("reconcileDriveSync — cambio remoto (pull_update)", () => {
  it("propone pull_update cuando Drive cambió y lo local no", () => {
    const t = transcription();
    const map = mapEntry(t);
    const change: DriveChangeInput = {
      fileId: "drive-1",
      removed: false,
      trashed: false,
      modifiedTime: NEWER,
      md5Checksum: "otro-md5-distinto",
    };

    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([
      { type: "pull_update", transcriptionId: "t1", driveFileId: "drive-1", isConflict: false },
    ]);
  });
});

describe("reconcileDriveSync — borrados", () => {
  it("propone delete_in_drive cuando la transcripción se borró localmente", () => {
    const base = transcription();
    const map = mapEntry(base);
    const deleted = transcription({ deletedAt: NEWER, updatedAt: NEWER });

    const { actions } = reconcileDriveSync({ transcriptions: [deleted], fileMap: [map], driveChanges: [] });

    expect(actions).toEqual([{ type: "delete_in_drive", transcriptionId: "t1", driveFileId: "drive-1" }]);
  });

  it("propone delete_local cuando Drive marca el archivo como trashed", () => {
    const t = transcription();
    const map = mapEntry(t);
    const change: DriveChangeInput = { fileId: "drive-1", removed: false, trashed: true, modifiedTime: NEWER };

    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([{ type: "delete_local", transcriptionId: "t1", driveFileId: "drive-1" }]);
  });

  it("propone delete_local cuando Drive marca `removed: true` (borrado duro)", () => {
    const t = transcription();
    const map = mapEntry(t);
    const change: DriveChangeInput = { fileId: "drive-1", removed: true, trashed: false };

    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([{ type: "delete_local", transcriptionId: "t1", driveFileId: "drive-1" }]);
  });

  it("es idempotente si ya estaba borrado de los dos lados (confirma el tombstone)", () => {
    const t = transcription({ deletedAt: OLD });
    const map = mapEntry(t);
    const change: DriveChangeInput = { fileId: "drive-1", removed: false, trashed: true, modifiedTime: NEWER };

    const { actions } = reconcileDriveSync({ transcriptions: [t], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([{ type: "delete_local", transcriptionId: "t1", driveFileId: "drive-1" }]);
  });
});

describe("reconcileDriveSync — conflicto (cambió en los dos lados)", () => {
  it("gana lo local si su updatedAt es más nuevo que el modifiedTime de Drive (push_update con isConflict)", () => {
    const base = transcription();
    const map = mapEntry(base);
    const edited = transcription({ text: "Edición local, la más nueva.", updatedAt: NEWEST });
    const change: DriveChangeInput = {
      fileId: "drive-1",
      removed: false,
      trashed: false,
      modifiedTime: NEWER, // más vieja que el updatedAt local
      md5Checksum: "md5-de-la-edicion-en-drive",
    };

    const { actions } = reconcileDriveSync({ transcriptions: [edited], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([
      expect.objectContaining({ type: "push_update", transcriptionId: "t1", driveFileId: "drive-1", isConflict: true }),
    ]);
  });

  it("gana lo remoto si el modifiedTime de Drive es más nuevo (pull_update con isConflict)", () => {
    const base = transcription();
    const map = mapEntry(base);
    const edited = transcription({ text: "Edición local, más vieja.", updatedAt: NEWER });
    const change: DriveChangeInput = {
      fileId: "drive-1",
      removed: false,
      trashed: false,
      modifiedTime: NEWEST, // más nueva que el updatedAt local
      md5Checksum: "md5-de-la-edicion-en-drive",
    };

    const { actions } = reconcileDriveSync({ transcriptions: [edited], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([
      { type: "pull_update", transcriptionId: "t1", driveFileId: "drive-1", isConflict: true },
    ]);
  });

  it("protege una edición local más nueva que un borrado remoto (push_update con isConflict en vez de delete_local)", () => {
    const base = transcription();
    const map = mapEntry(base);
    const edited = transcription({ text: "Edité justo antes de que lo borraran en Drive.", updatedAt: NEWEST });
    const change: DriveChangeInput = { fileId: "drive-1", removed: false, trashed: true, modifiedTime: NEWER };

    const { actions } = reconcileDriveSync({ transcriptions: [edited], fileMap: [map], driveChanges: [change] });

    expect(actions).toEqual([
      expect.objectContaining({ type: "push_update", transcriptionId: "t1", driveFileId: "drive-1", isConflict: true }),
    ]);
  });
});

describe("reconcileDriveSync — freno anti-borrado-masivo", () => {
  it("pausa los delete_local y prende massDeleteGuardTriggered si superan el umbral", () => {
    const transcriptions: CloudTranscriptionInput[] = [];
    const fileMap: DriveFileMapEntry[] = [];
    const driveChanges: DriveChangeInput[] = [];

    for (let i = 0; i < 4; i++) {
      const t = transcription({ id: `t${i}`, title: `Nota ${i}` });
      transcriptions.push(t);
      fileMap.push(mapEntry(t, { driveFileId: `drive-${i}` }));
      driveChanges.push({ fileId: `drive-${i}`, removed: false, trashed: true, modifiedTime: NEWER });
    }

    const { actions, massDeleteGuardTriggered } = reconcileDriveSync({ transcriptions, fileMap, driveChanges });

    expect(massDeleteGuardTriggered).toBe(true);
    expect(actions.filter((a) => a.type === "delete_local")).toHaveLength(0);
    expect(actions.every((a) => a.type === "noop" && a.reason === "freno_borrado_masivo")).toBe(true);
  });

  it("no se activa con pocos borrados (bajo el umbral)", () => {
    const transcriptions: CloudTranscriptionInput[] = [];
    const fileMap: DriveFileMapEntry[] = [];
    const driveChanges: DriveChangeInput[] = [];

    // 5 mapeados, 1 solo borrado: 20%, bajo el umbral del 50%.
    for (let i = 0; i < 5; i++) {
      const t = transcription({ id: `t${i}`, title: `Nota ${i}` });
      transcriptions.push(t);
      fileMap.push(mapEntry(t, { driveFileId: `drive-${i}` }));
    }
    driveChanges.push({ fileId: "drive-0", removed: false, trashed: true, modifiedTime: NEWER });

    const { actions, massDeleteGuardTriggered } = reconcileDriveSync({ transcriptions, fileMap, driveChanges });

    expect(massDeleteGuardTriggered).toBe(false);
    expect(actions.filter((a) => a.type === "delete_local")).toHaveLength(1);
  });
});

describe("reconcileDriveSync — defensivo", () => {
  it("noop con sin_mapeo_local si un cambio de Drive no tiene fila en drive_file_map", () => {
    const change: DriveChangeInput = { fileId: "drive-huerfano", removed: false, trashed: false, md5Checksum: "x" };
    const { actions } = reconcileDriveSync({ transcriptions: [], fileMap: [], driveChanges: [change] });
    expect(actions).toEqual([{ type: "noop", driveFileId: "drive-huerfano", reason: "sin_mapeo_local" }]);
  });
});
