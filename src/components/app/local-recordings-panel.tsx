"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/Toast";
import { formatDuration, formatFileSize } from "@/lib/format";
import { useLocalRecordings } from "@/lib/recordings/use-local-recordings";
import { canRetry, describeStatus, isIrreplaceable, totalBytes } from "@/lib/recordings/policy";
import { uploadStoredRecording } from "@/lib/recordings/flow";
import type { LocalRecordingMeta } from "@/lib/recordings/types";
import type { TranscriptionDefaults } from "@/lib/settings/user-settings";

/**
 * The on-device recording library.
 *
 * Exists because a recording used to live only in the tab's RAM between "Detener" and the server
 * acking the upload — a 413, a dropped connection or Android reclaiming a backgrounded tab
 * destroyed audio that cannot be re-made. Everything captured on this device is listed here, and
 * the audio is always downloadable even when it can never be transcribed on the web.
 */
export function LocalRecordingsPanel({
  defaults,
  /** When true, only shows recordings the server does not have yet (used on the capture screen). */
  pendingOnly = false,
  onUploaded,
}: {
  defaults: TranscriptionDefaults;
  pendingOnly?: boolean;
  onUploaded?: () => void;
}) {
  const { show: toast } = useToast();
  const { recordings, loading, available, refresh, remove, download } = useLocalRecordings();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Two-step delete instead of a modal: the second click confirms. Deleting an irreplaceable
  // recording is the one destructive action here, so it never happens on a single tap.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const visible = pendingOnly ? recordings.filter(isIrreplaceable) : recordings;

  const retry = useCallback(
    async (recording: LocalRecordingMeta) => {
      setBusyId(recording.id);
      try {
        const outcome = await uploadStoredRecording(recording.id, {
          language: defaults.language,
          model: defaults.quality,
          mode: "transcribe",
          title: recording.title,
        });
        if (outcome.ok) {
          toast("Listo, la grabación se transcribió.", "success");
          onUploaded?.();
        } else {
          toast(outcome.message, outcome.status === "too_large" ? "info" : "error");
        }
      } catch {
        toast("No se pudo subir la grabación. Sigue guardada acá.", "error");
      } finally {
        setBusyId(null);
        await refresh();
      }
    },
    [defaults.language, defaults.quality, onUploaded, refresh, toast]
  );

  const handleDownload = useCallback(
    async (recording: LocalRecordingMeta) => {
      const ok = await download(recording.id);
      if (!ok) toast("No se encontró el audio de esa grabación.", "error");
    },
    [download, toast]
  );

  const handleDelete = useCallback(
    async (recording: LocalRecordingMeta) => {
      if (confirmingId !== recording.id) {
        setConfirmingId(recording.id);
        return;
      }
      setConfirmingId(null);
      await remove(recording.id);
      toast("Grabación borrada de este dispositivo.", "info");
    },
    [confirmingId, remove, toast]
  );

  if (!available) {
    return (
      <p className="text-sm text-tertiary">
        Este navegador no puede guardar grabaciones en el dispositivo. Descargá cada grabación apenas la termines.
      </p>
    );
  }

  if (loading || !visible.length) return null;

  const pendingCount = visible.filter(isIrreplaceable).length;

  return (
    <section className="w-full text-left">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-secondary">
          {pendingOnly ? "Grabaciones sin subir" : "Grabaciones en este dispositivo"}
        </h2>
        <p className="text-xs text-tertiary">{formatFileSize(totalBytes(visible))}</p>
      </header>

      {pendingCount > 0 && (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {pendingCount === 1
            ? "Esta grabación todavía está solo acá. Descargala o subila para no depender de este dispositivo."
            : `${pendingCount} grabaciones están todavía solo acá. Descargalas o subilas para no depender de este dispositivo.`}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {visible.map((recording) => (
          <li key={recording.id} className="rounded-xl border border-subtle bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{recording.title}</p>
              <p className="text-xs tabular-nums text-tertiary">
                {formatDuration(recording.durationSec)} · {formatFileSize(recording.sizeBytes)}
              </p>
            </div>
            <p className="mt-1 text-xs text-tertiary">{describeStatus(recording)}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void handleDownload(recording)}>
                <Icon name="download" className="shrink-0" />
                Descargar
              </Button>

              {canRetry(recording) && (
                <Button
                  size="sm"
                  onClick={() => void retry(recording)}
                  loading={busyId === recording.id}
                  disabled={busyId !== null}
                >
                  {recording.attempts > 0 ? "Reintentar" : "Subir y transcribir"}
                </Button>
              )}

              {recording.status === "uploaded" && recording.transcriptionId && (
                <Link
                  href={`/app/t/${recording.transcriptionId}`}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Ver la nota →
                </Link>
              )}

              {recording.status === "too_large" && (
                <Link href="/descargar" className="text-xs font-semibold text-accent hover:underline">
                  Ver la app de escritorio →
                </Link>
              )}

              <Button
                size="sm"
                variant={confirmingId === recording.id ? "danger" : "ghost"}
                onClick={() => void handleDelete(recording)}
                disabled={busyId !== null}
              >
                {confirmingId === recording.id
                  ? isIrreplaceable(recording)
                    ? "Borrar igual, sin copia"
                    : "Confirmar"
                  : "Borrar"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
