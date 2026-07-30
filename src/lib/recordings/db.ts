/**
 * IndexedDB layer for the on-device recording library. Deliberately thin: every rule worth
 * testing lives in `policy.ts` (pure, covered by Vitest); this file only moves bytes.
 *
 * Metadata and audio live in SEPARATE stores so listing the library never has to touch a single
 * blob — a phone holding hours of audio still renders the list instantly.
 */

import type { LocalRecording, LocalRecordingMeta, LocalRecordingSource } from "./types";
import { selectPurgeCandidates } from "./policy";

const DB_NAME = "audio-transcriber";
const DB_VERSION = 1;
const META_STORE = "recording-meta";
const BLOB_STORE = "recording-blobs";

/** False when the browser has no IndexedDB (SSR, or a locked-down private mode). */
export function isLocalLibraryAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isLocalLibraryAvailable()) {
      reject(new Error("Este navegador no puede guardar grabaciones en el dispositivo."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacenamiento local."));
  });
}

/** Resolves when the whole transaction commits — not when the individual request succeeds. */
function runTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => T | Promise<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result: T;
        // Waiting for `oncomplete` (not the request callback) is what makes a save durable: a
        // transaction that aborts after a successful put would otherwise report success and drop
        // the only copy of the audio.
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("No se pudo escribir en el almacenamiento local."));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("El almacenamiento del dispositivo está lleno."));
        };
        Promise.resolve(work(tx)).then(
          (value) => {
            result = value;
          },
          (err) => {
            reject(err);
            tx.abort();
          }
        );
      })
  );
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló una operación de almacenamiento."));
  });
}

export type NewRecording = {
  blob: Blob;
  fileName: string;
  title: string;
  mimeType: string;
  durationSec: number;
  source: LocalRecordingSource;
};

/**
 * Persists a freshly stopped recording. Call this BEFORE attempting any upload — that ordering is
 * the entire point of this module.
 *
 * Rejects if the write fails (typically the device being out of space). Callers must surface that
 * loudly: it is the only moment where the audio can still be lost.
 */
export async function saveRecording(input: NewRecording): Promise<LocalRecordingMeta> {
  const meta: LocalRecordingMeta = {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    title: input.title,
    mimeType: input.mimeType,
    sizeBytes: input.blob.size,
    durationSec: input.durationSec,
    createdAt: Date.now(),
    source: input.source,
    status: "pending",
    attempts: 0,
  };
  await runTransaction([META_STORE, BLOB_STORE], "readwrite", (tx) => {
    tx.objectStore(BLOB_STORE).put(input.blob, meta.id);
    tx.objectStore(META_STORE).put(meta);
  });
  return meta;
}

export async function listRecordings(): Promise<LocalRecordingMeta[]> {
  if (!isLocalLibraryAvailable()) return [];
  return runTransaction([META_STORE], "readonly", (tx) =>
    requestToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<LocalRecordingMeta[]>)
  );
}

export async function getRecordingBlob(id: string): Promise<Blob | null> {
  if (!isLocalLibraryAvailable()) return null;
  const blob = await runTransaction([BLOB_STORE], "readonly", (tx) =>
    requestToPromise(tx.objectStore(BLOB_STORE).get(id) as IDBRequest<Blob | undefined>)
  );
  return blob ?? null;
}

/** Metadata only — cheap, and enough to decide what to do next with a recording. */
export async function getRecordingMeta(id: string): Promise<LocalRecordingMeta | null> {
  if (!isLocalLibraryAvailable()) return null;
  const meta = await runTransaction([META_STORE], "readonly", (tx) =>
    requestToPromise(tx.objectStore(META_STORE).get(id) as IDBRequest<LocalRecordingMeta | undefined>)
  );
  return meta ?? null;
}

/** Metadata + audio together, for retrying an upload or handing the file to a download. */
export async function getRecording(id: string): Promise<LocalRecording | null> {
  if (!isLocalLibraryAvailable()) return null;
  const found = await runTransaction([META_STORE, BLOB_STORE], "readonly", async (tx) => {
    const meta = await requestToPromise(tx.objectStore(META_STORE).get(id) as IDBRequest<LocalRecordingMeta | undefined>);
    if (!meta) return null;
    const blob = await requestToPromise(tx.objectStore(BLOB_STORE).get(id) as IDBRequest<Blob | undefined>);
    return blob ? { ...meta, blob } : null;
  });
  return found;
}

export async function updateRecording(
  id: string,
  patch: Partial<Omit<LocalRecordingMeta, "id">>
): Promise<LocalRecordingMeta | null> {
  if (!isLocalLibraryAvailable()) return null;
  return runTransaction([META_STORE], "readwrite", async (tx) => {
    const store = tx.objectStore(META_STORE);
    const current = await requestToPromise(store.get(id) as IDBRequest<LocalRecordingMeta | undefined>);
    if (!current) return null;
    const next = { ...current, ...patch };
    store.put(next);
    return next;
  });
}

export async function deleteRecording(id: string): Promise<void> {
  if (!isLocalLibraryAvailable()) return;
  await runTransaction([META_STORE, BLOB_STORE], "readwrite", (tx) => {
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
  });
}

/**
 * Trims the library back inside its quota, oldest already-uploaded recording first. Anything the
 * server does not have yet is untouchable — see `selectPurgeCandidates`.
 *
 * @returns ids actually removed (empty when nothing needed to go).
 */
export async function enforceQuota(quotaBytes?: number): Promise<string[]> {
  if (!isLocalLibraryAvailable()) return [];
  const all = await listRecordings();
  const doomed = selectPurgeCandidates(all, quotaBytes === undefined ? {} : { quotaBytes });
  for (const id of doomed) await deleteRecording(id);
  return doomed;
}
