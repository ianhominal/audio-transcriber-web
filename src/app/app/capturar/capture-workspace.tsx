"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/icon";
import { formatDuration, formatRecordingFileName, defaultTitleFromFileName } from "@/lib/format";
import { AUDIO_MIME_CANDIDATES, pickSupportedMimeType, extensionForMimeType, WEB_MAX_BYTES } from "@/lib/recording";
import type { TranscriptionDefaults } from "@/lib/settings/user-settings";

type Phase = "requesting" | "recording" | "uploading" | "done" | "error";

/**
 * Captura sin fricción (ver brainstorm homónimo): a diferencia de `TranscribeWorkspace`, esta
 * pantalla NO tiene selector de proyecto/idioma/calidad ni cola — pide el micrófono apenas monta,
 * graba con un solo botón grande de Detener, y al frenar sube DIRECTO a `/api/transcribe` con los
 * defaults persistentes del usuario (mismos `defaults.language`/`defaults.quality` que
 * `TranscribeWorkspace` usa como valor inicial). Cero pasos entre "se me ocurrió algo" y grabar.
 */
export function CaptureWorkspace({
  defaults,
  initialError,
}: {
  defaults: TranscriptionDefaults;
  // Presente cuando `/api/share-target` (ver route.ts) no pudo transcribir un audio compartido
  // desde otra app y redirigió acá con el motivo — en ese caso NO arrancamos a grabar solos:
  // mostramos el error y dejamos que la usuaria decida (reintentar grabando, o ir a subir el
  // archivo a mano desde `/app/transcribe`).
  initialError?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialError ? "error" : "requesting");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState(initialError ?? "");
  const [resultId, setResultId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Última grabación pendiente de subir — permite "Reintentar" sin volver a grabar si solo falló
  // la subida (no tiene sentido perder el audio ya grabado por un error de red transitorio). Vive
  // en estado (no en un ref) porque el render la lee para decidir "Reintentar" vs "Grabar" — leer
  // un ref durante el render rompe las reglas de React (el valor puede quedar desactualizado).
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const uploadRecording = useCallback(
    async (file: File) => {
      if (file.size > WEB_MAX_BYTES) {
        setPendingFile(null);
        setPhase("error");
        setMessage("La grabación es muy larga para la web (+4,5 MB). Grabá algo más corto o usá la app de escritorio.");
        return;
      }
      setPendingFile(file);
      setPhase("uploading");
      setMessage("");
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("language", defaults.language);
        form.append("model", defaults.quality);
        form.append("mode", "transcribe");
        // Mismo título automático que `TranscribeWorkspace.enqueueRecording` (ver
        // `defaultTitleFromFileName`/`isPlaceholderTitle` en el server): el server lo reemplaza por
        // un título generado por IA en cuanto puede (paso 2.7 de `/api/transcribe`).
        form.append("title", defaultTitleFromFileName(file.name));

        const resp = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "No se pudo transcribir la grabación.");

        setPendingFile(null);
        setResultId(typeof data.id === "string" ? data.id : null);
        setPhase("done");
        router.refresh(); // que el dashboard vea la nueva transcripción
      } catch (e) {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "No se pudo subir la grabación.");
      }
    },
    [defaults.language, defaults.quality, router]
  );

  const startRecording = useCallback(async () => {
    // Yield a microtask before the first setState below: `startRecording` is invoked directly
    // from the mount effect (see the "Arranca a grabar solo" effect further down) to kick off the
    // mic permission prompt as soon as this screen loads — a legitimate "synchronize with an
    // external system" effect (recording), not a derive-state-from-props one, but
    // `react-hooks/set-state-in-effect` can't tell those apart structurally: it flags ANY setState
    // reachable synchronously (before the first `await`) from an effect's call graph. Awaiting a
    // resolved promise first turns every setState below into "updated from an async callback" —
    // the exact pattern the rule (and React's own docs) sanction — with no perceptible delay.
    await Promise.resolve();
    setMessage("");
    setPhase("requesting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setMessage("Este navegador no soporta grabar audio desde el micrófono.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType(AUDIO_MIME_CANDIDATES);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const usedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: usedType });
        const ext = extensionForMimeType(usedType);
        const file = new File([blob], formatRecordingFileName("Grabacion", Date.now(), ext), {
          type: usedType,
        });
        stream.getTracks().forEach((t) => t.stop());
        void uploadRecording(file);
      };
      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      setSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setPhase("error");
      setMessage(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Permiso de micrófono denegado. Habilitalo en la configuración del navegador para grabar."
          : "No se pudo acceder al micrófono."
      );
    }
  }, [uploadRecording]);

  const stopRecording = useCallback(() => {
    stopTimer();
    recorderRef.current?.stop(); // dispara onstop, que sube la grabación
    recorderRef.current = null;
  }, []);

  const retryUpload = useCallback(() => {
    if (pendingFile) void uploadRecording(pendingFile);
  }, [pendingFile, uploadRecording]);

  const recordAgain = useCallback(() => {
    setResultId(null);
    setPendingFile(null);
    void startRecording();
  }, [startRecording]);

  // Arranca a grabar solo apenas monta esta pantalla — a menos que haya un `initialError` (llegada
  // desde `/api/share-target`), en cuyo caso esperamos a que la usuaria toque "Grabar" a propósito
  // en vez de pedir el micrófono sin que lo haya pedido.
  //
  // El kick-off vive en un `setTimeout(…, 0)` en vez de llamarse directo: `react-hooks/set-state-in-effect`
  // no puede ver que `startRecording` ya difiere su primer setState hasta después de un `await`
  // (ver comentario ahí) porque es una referencia externa (no una función literal dentro del
  // efecto) — un callback de `setTimeout` es exactamente el patrón que la regla espera para
  // "avisar a React cuando el sistema externo (el micrófono) cambia" (mismo criterio que
  // documenta https://react.dev/learn/you-might-not-need-an-effect). Sin timer real: 0ms es
  // indistinguible para la usuaria de una llamada directa.
  useEffect(() => {
    if (initialError) return;
    const timeoutId = window.setTimeout(() => void startRecording(), 0);
    return () => {
      window.clearTimeout(timeoutId);
      stopTimer();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, `initialError` es fijo para esta instancia
  }, []);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col px-4 py-6 text-center">
      <div className="mb-4 text-left">
        <Link
          href="/app"
          className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
        >
          ← Volver
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
      {/* Región anunciable: el estado ("Grabando…", errores, éxito) se lee solo, sin que la usuaria
          tenga que mirar la pantalla — clave para un flujo pensado para usar sobre la marcha.
          A PROPÓSITO no incluye `seconds`: el texto de este párrafo cambia solo en las
          transiciones de fase (review adversarial — hallazgo MEDIUM: antes el texto embebía el
          cronómetro, así que cambiaba cada segundo mientras se graba y un lector de pantalla en
          una región `assertive` volvía a interrumpir/anunciar una vez por segundo durante TODA la
          grabación — justo hostil para la usuaria que este flujo busca ayudar). El cronómetro
          visual (`formatDuration(seconds)` más abajo) sigue actualizándose normalmente, solo que
          fuera de esta región `aria-live`. */}
      <p role="status" aria-live="assertive" className="sr-only">
        {statusAnnouncement(phase, message)}
      </p>

      {phase === "requesting" && (
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" className="text-accent" />
          <p className="text-secondary">Pidiendo permiso de micrófono…</p>
        </div>
      )}

      {phase === "recording" && (
        <div className="flex flex-col items-center gap-5">
          <p className="text-lg font-semibold text-secondary">Grabando…</p>
          <p className="font-mono text-4xl font-bold tabular-nums text-foreground" aria-hidden="true">
            {formatDuration(seconds)}
          </p>
          <button
            type="button"
            onClick={stopRecording}
            aria-label={`Detener grabación · ${formatDuration(seconds)}`}
            className="tap-target flex h-32 w-32 items-center justify-center gap-2 rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700 focus-visible:outline focus-visible:outline-4 focus-visible:outline-red-300 active:scale-95"
          >
            <span className="flex flex-col items-center gap-1">
              <span className="h-3 w-3 animate-pulse rounded-full bg-white" aria-hidden="true" />
              <span className="text-base font-bold">Detener</span>
            </span>
          </button>
        </div>
      )}

      {phase === "uploading" && (
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" className="text-accent" />
          <p className="text-secondary">Transcribiendo tu idea…</p>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col items-center gap-4">
          <p aria-hidden="true">
            <Icon name="success" size={28} className="text-emerald-500" />
          </p>
          <p className="text-lg font-semibold text-secondary">Listo, quedó guardada.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={recordAgain} size="lg">
              <Icon name="mic" className="shrink-0" />
              Grabar otra
            </Button>
            {resultId ? (
              <Link href={`/app/t/${resultId}`} className="text-sm font-semibold text-accent hover:underline">
                Ver transcripción →
              </Link>
            ) : (
              <Link href="/app" className="text-sm font-semibold text-accent hover:underline">
                Ir al dashboard →
              </Link>
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-4">
          <p aria-hidden="true">
            <Icon name="warning" size={28} className="text-amber-500" />
          </p>
          <p role="alert" className="text-secondary">
            {message || "Ocurrió un error."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {pendingFile ? (
              <Button onClick={retryUpload} size="lg">
                Reintentar
              </Button>
            ) : (
              <Button onClick={recordAgain} size="lg">
                <Icon name="mic" className="shrink-0" />
                Grabar
              </Button>
            )}
            <Link href="/app/transcribe" className="text-sm font-semibold text-accent hover:underline">
              Subir un archivo →
            </Link>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Texto para el `aria-live` — separado del JSX visual para poder testear la lógica sin DOM.
 * A propósito NO recibe `seconds`: tiene que devolver el MISMO string mientras dure una fase
 * (ver comentario junto al `<p aria-live>` en el render) para que un lector de pantalla anuncie
 * cada transición de fase una sola vez, no cada segundo que pasa grabando.
 */
export function statusAnnouncement(phase: Phase, message: string): string {
  switch (phase) {
    case "requesting":
      return "Pidiendo permiso de micrófono.";
    case "recording":
      return "Grabando.";
    case "uploading":
      return "Transcribiendo tu idea.";
    case "done":
      return "Listo, quedó guardada.";
    case "error":
      return message || "Ocurrió un error.";
  }
}
