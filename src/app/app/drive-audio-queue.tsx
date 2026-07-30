"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import { driveBatchProgressLabel, shouldStopBatch } from "@/lib/drive/audio-import";

type PendingAudio = { id: string; title: string; audio_name: string };

/**
 * Banner de "audios de Drive sin transcribir".
 *
 * Conectar una carpeta de Drive trae los audios como notas PENDIENTES (sin texto todavía): bajar y
 * transcribir 14 grabaciones no entra en el `maxDuration` de un request, y además consume cuota de
 * Groq, así que dispararlo es una decisión explícita de la usuaria y no un efecto secundario de
 * conectar la carpeta.
 *
 * Procesa de a UNO, en serie — mismo patrón que la cola de `/app/transcribe`. Cada audio que sale
 * queda guardado aunque el siguiente falle, el progreso se ve, y se puede frenar en el medio.
 */
export function DriveAudioQueue() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAudio[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finishedMessage, setFinishedMessage] = useState<string | null>(null);
  // Guard SÍNCRONO contra doble click (un `running` de estado se actualiza demasiado tarde), y
  // bandera de cancelación que el loop consulta entre audios. Mismo criterio que `runningRef` en
  // `transcribe-workspace`.
  const runningRef = useRef(false);
  const cancelRef = useRef(false);

  // Función nombrada, no un `setState` directo en el cuerpo del efecto: el fetch dispara sus propios
  // cambios de estado dentro del handler async, que es lo que evita el `react-hooks/set-state-in-effect`.
  // Mismo patrón (y misma razón) que `loadFolders` en `ajustes/drive-folder-connect.tsx`.
  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/transcribe");
      if (!res.ok) return;
      const body = await res.json();
      setPending((body.pending ?? []) as PendingAudio[]);
    } catch {
      // Silencio a propósito: es un banner opcional, nunca debe romper el dashboard.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOnMount() {
      try {
        const res = await fetch("/api/drive/transcribe");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setPending((body.pending ?? []) as PendingAudio[]);
      } catch {
        // Ver `loadPending`: el banner nunca debe romper el dashboard.
      }
    }

    loadOnMount();
    return () => {
      cancelled = true;
    };
  }, []);

  async function transcribeAll() {
    if (runningRef.current || pending.length === 0) return;
    runningRef.current = true;
    cancelRef.current = false;
    setRunning(true);
    setError(null);
    setFinishedMessage(null);
    setDone(0);

    let completed = 0;
    let failed = 0;

    for (const audio of pending) {
      if (cancelRef.current) break;

      try {
        const res = await fetch("/api/drive/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: audio.id }),
        });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          failed++;
          // Un error que afecta a TODOS (cuota diaria, sesión caída) corta la tanda; uno puntual
          // (archivo grande, audio mudo) solo marca ese y sigue con el resto.
          if (shouldStopBatch(body?.code, res.status)) {
            setError(body?.error || "Se interrumpió la transcripción.");
            break;
          }
          continue;
        }
        completed++;
        setDone(completed);
      } catch {
        failed++;
        setError("Se perdió la conexión. Lo que ya se transcribió quedó guardado.");
        break;
      }
    }

    runningRef.current = false;
    setRunning(false);
    await loadPending();
    router.refresh();

    if (completed > 0 || failed > 0) {
      setFinishedMessage(
        failed > 0
          ? `${completed} audio(s) transcripto(s). ${failed} quedaron pendientes.`
          : `${completed} audio(s) transcripto(s).`
      );
    }
  }

  if (pending.length === 0 && !finishedMessage) return null;

  const progress = driveBatchProgressLabel(done, pending.length);

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4">
      {pending.length > 0 ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium text-secondary">
            <Icon name="drive" className="shrink-0" />
            {pending.length === 1
              ? "Tenés 1 audio de Drive sin transcribir"
              : `Tenés ${pending.length} audios de Drive sin transcribir`}
          </p>
          <p className="mt-1 text-xs text-tertiary">
            Se transcriben de a uno y podés cerrar esta pestaña cuando termine. Cada audio cuenta para tu límite
            diario.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <Button onClick={transcribeAll} loading={running} disabled={running}>
              {running ? `Transcribiendo… ${progress ?? ""}` : "Transcribir todos"}
            </Button>
            {running && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                Frenar
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-200">
          <Icon name="success" className="shrink-0" /> Listo, no quedan audios de Drive pendientes.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {finishedMessage && !error && <p className="mt-2 text-xs text-tertiary">{finishedMessage}</p>}
    </div>
  );
}
