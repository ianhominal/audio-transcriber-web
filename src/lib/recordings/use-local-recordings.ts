"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocalRecordingMeta } from "./types";
import { deleteRecording, enforceQuota, getRecording, isLocalLibraryAvailable, listRecordings } from "./db";
import { sortForDisplay } from "./policy";
import { toFile } from "./flow";

/**
 * Reads the on-device recording library for the UI.
 *
 * Never throws: a browser without IndexedDB (or one that refuses to open it) simply reports an
 * empty library, so the capture screens keep working — degraded, but working.
 */
export function useLocalRecordings() {
  const [recordings, setRecordings] = useState<LocalRecordingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [available] = useState(isLocalLibraryAvailable);

  const refresh = useCallback(async () => {
    try {
      const all = await listRecordings();
      setRecordings(sortForDisplay(all));
    } catch {
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Trimming runs before the first read so the list never shows entries we are about to drop.
    // Both calls are awaited, so every setState above happens in an async callback.
    void enforceQuota()
      .catch(() => [])
      .then(refresh);
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await deleteRecording(id);
      await refresh();
    },
    [refresh]
  );

  /**
   * Hands the stored audio to the browser as a download. Built and revoked inside this call: an
   * object URL kept in state is exactly the kind of memory-only copy this library exists to avoid.
   */
  const download = useCallback(async (id: string) => {
    const recording = await getRecording(id);
    if (!recording) return false;
    const url = URL.createObjectURL(toFile(recording));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = recording.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some browsers; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }, []);

  return { recordings, loading, available, refresh, remove, download };
}
