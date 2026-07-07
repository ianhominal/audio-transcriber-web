"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProject } from "../actions";
import { EmojiPicker } from "../emoji-picker";
import { formatFileSize, formatDuration, formatRecordingFileName } from "@/lib/format";

// Formatos que Groq/Whisper acepta nativamente (mp4/mpeg incluidos: extrae el audio del video).
const SUPPORTED = [
  ".mp3", ".wav", ".ogg", ".opus", ".m4a", ".mp4",
  ".mpeg", ".mpga", ".flac", ".webm",
];

// Límite de payload de Vercel (~4.5 MB). Los audios más grandes se derivan a la app de escritorio.
const WEB_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

// Candidatos de mimeType para MediaRecorder, en orden de preferencia (el navegador soporta un subconjunto).
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

/** Elige el primer mimeType soportado por MediaRecorder en este navegador. */
function pickSupportedMimeType(candidates: string[]): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Extensión de archivo acorde al mimeType grabado (webm u ogg). */
function extensionForMimeType(mimeType: string): string {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

type Project = { id: string; name: string; icon: string };
type Status = "pending" | "working" | "done" | "duplicate" | "error";
type Item = { key: string; file: File; status: Status; resultId?: string; error?: string };

let counter = 0;
const nextKey = () => `f${++counter}`;

export function TranscribeWorkspace({
  projects,
  initialProject = "",
}: {
  projects: Project[];
  initialProject?: string;
}) {
  const router = useRouter();
  const [destino, setDestino] = useState<string>(initialProject); // "" | projectId | "__new__"
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("📁");
  const [language, setLanguage] = useState("es"); // default español; recordamos la última elección
  const [model, setModel] = useState("whisper-large-v3-turbo");

  // Recuperar la última preferencia de idioma (persistida en el navegador).
  useEffect(() => {
    const saved = localStorage.getItem("transcribe:language");
    if (saved) setLanguage(saved);
  }, []);

  const changeLanguage = (value: string) => {
    setLanguage(value);
    localStorage.setItem("transcribe:language", value);
  };
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [topError, setTopError] = useState("");
  const runningRef = useRef(false); // guard SÍNCRONO contra doble-submit
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Grabar desde el micrófono ---
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordError, setRecordError] = useState("");
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const micTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Capturar audio de una reunión (pestaña/pantalla) ---
  const [capturing, setCapturing] = useState(false);
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [captureError, setCaptureError] = useState("");
  const captureRecorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureChunksRef = useRef<Blob[]>([]);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const nuevos: Item[] = Array.from(files).map((file) => ({
      key: nextKey(),
      file,
      status: "pending" as Status,
    }));
    setItems((prev) => [...prev, ...nuevos]);
  }, []);

  const stopMicRecording = useCallback(() => {
    if (micTimerRef.current) {
      clearInterval(micTimerRef.current);
      micTimerRef.current = null;
    }
    micRecorderRef.current?.stop(); // dispara onstop, que agrega el File a la cola
    micRecorderRef.current = null;
    setRecording(false);
  }, []);

  const startMicRecording = useCallback(async () => {
    setRecordError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordError("Este navegador no soporta grabar audio desde el micrófono.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType(AUDIO_MIME_CANDIDATES);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      micChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) micChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const usedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(micChunksRef.current, { type: usedType });
        const ext = extensionForMimeType(usedType);
        const file = new File([blob], formatRecordingFileName("Grabacion", Date.now(), ext), {
          type: usedType,
        });
        setItems((prev) => [...prev, { key: nextKey(), file, status: "pending" as Status }]);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      micRecorderRef.current = recorder;
      micStreamRef.current = stream;
      setRecordingSeconds(0);
      setRecording(true);
      micTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setRecordError(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Permiso de micrófono denegado. Habilitalo en la configuración del navegador para grabar."
          : "No se pudo acceder al micrófono."
      );
    }
  }, []);

  const stopMeetingCapture = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    captureRecorderRef.current?.stop(); // dispara onstop, que agrega el File a la cola
    captureRecorderRef.current = null;
    setCapturing(false);
  }, []);

  const startMeetingCapture = useCallback(async () => {
    setCaptureError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError("Este navegador no soporta capturar audio de una pestaña o pantalla.");
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach((t) => t.stop());
        setCaptureError(
          'No se detectó audio en lo compartido. Al elegir la pestaña, tildá "Compartir audio de la pestaña".'
        );
        return;
      }
      const audioStream = new MediaStream(audioTracks);
      const mimeType = pickSupportedMimeType(AUDIO_MIME_CANDIDATES);
      const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      captureChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) captureChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const usedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(captureChunksRef.current, { type: usedType });
        const ext = extensionForMimeType(usedType);
        const file = new File([blob], formatRecordingFileName("Reunion", Date.now(), ext), {
          type: usedType,
        });
        setItems((prev) => [...prev, { key: nextKey(), file, status: "pending" as Status }]);
        displayStream.getTracks().forEach((t) => t.stop());
      };
      // Si el usuario corta el compartir desde el propio navegador, cerramos la grabación prolijamente.
      displayStream.getVideoTracks()[0]?.addEventListener("ended", stopMeetingCapture);
      recorder.start();
      captureRecorderRef.current = recorder;
      captureStreamRef.current = displayStream;
      setCaptureSeconds(0);
      setCapturing(true);
      captureTimerRef.current = setInterval(() => setCaptureSeconds((s) => s + 1), 1000);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setCaptureError(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Permiso de captura denegado."
          : "No se pudo iniciar la captura de pantalla/pestaña."
      );
    }
  }, [stopMeetingCapture]);

  // Limpieza al desmontar: no dejar streams ni timers vivos.
  useEffect(() => {
    return () => {
      if (micTimerRef.current) clearInterval(micTimerRef.current);
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
      micRecorderRef.current?.stop();
      captureRecorderRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      captureStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const patch = (key: string, data: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...data } : i)));

  const pendingCount = items.filter((i) => i.status === "pending").length;

  async function run() {
    if (runningRef.current) return; // gana la carrera del doble-click
    const toProcess = items.filter((i) => i.status === "pending");
    if (!toProcess.length) return;

    runningRef.current = true;
    setRunning(true);
    setTopError("");

    // Resolver el proyecto destino (crear si es nuevo).
    let projectId: string | null = null;
    if (destino === "__new__") {
      const fd = new FormData();
      fd.set("name", newName);
      fd.set("icon", newIcon);
      const res = await createProject(fd);
      if (!res.ok) {
        setTopError(res.error ?? "No se pudo crear el proyecto.");
        runningRef.current = false;
        setRunning(false);
        return;
      }
      projectId = res.id;
    } else if (destino) {
      projectId = destino;
    }

    // Procesar en serie (respeta la cuota de Groq y da progreso claro).
    for (const item of toProcess) {
      // Los archivos grandes no pasan por la web (límite de Vercel): se derivan a la app.
      if (item.file.size > WEB_MAX_BYTES) {
        patch(item.key, {
          status: "error",
          error: "Muy grande para la web (+4,5 MB). Usá la app de escritorio.",
        });
        continue;
      }
      patch(item.key, { status: "working", error: undefined });
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("language", language);
        form.append("model", model);
        if (projectId) form.append("projectId", projectId);

        const resp = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "No se pudo transcribir.");
        patch(item.key, {
          status: data.duplicate ? "duplicate" : "done",
          resultId: data.id ?? undefined,
        });
      } catch (e) {
        patch(item.key, { status: "error", error: e instanceof Error ? e.message : "Error." });
      }
    }

    runningRef.current = false;
    setRunning(false);
    router.refresh(); // que el dashboard vea las nuevas
  }

  const dashboardHref = destino && destino !== "__new__" ? `/app?project=${destino}` : "/app";
  const doneCount = items.filter((i) => i.status === "done" || i.status === "duplicate").length;
  const allDone = items.length > 0 && items.every((i) => i.status !== "pending" && i.status !== "working");
  const hasOversize = items.some((i) => i.file.size > WEB_MAX_BYTES);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nueva transcripción</h1>
        <Link href="/app" className="text-sm font-medium text-slate-500 hover:text-indigo-600">
          ← Volver
        </Link>
      </div>

      {/* Destino — siempre visible, para saber DÓNDE van a caer los audios */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="mb-1.5 block text-sm font-semibold text-slate-600">Proyecto destino</label>
        <select
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ""}
              {p.name}
            </option>
          ))}
          <option value="__new__">+ Crear proyecto nuevo…</option>
        </select>

        {destino === "__new__" && (
          <div className="mt-2 flex gap-2">
            <EmojiPicker value={newIcon} onChange={setNewIcon} />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del proyecto nuevo"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </div>
        )}

        {/* Opciones compactas */}
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-500">Idioma</span>
            <select value={language} onChange={(e) => changeLanguage(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="es">Español</option>
              <option value="en">Inglés</option>
              <option value="auto">Automático</option>
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-500">Calidad</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="whisper-large-v3-turbo">Rápida (turbo)</option>
              <option value="whisper-large-v3">Máxima (large-v3)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Dropzone múltiple */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED.join(",")}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="font-medium text-slate-700">Arrastrá tus audios acá</p>
        <p className="mt-1 text-sm text-slate-500">o hacé clic para elegirlos · podés cargar varios · mp3, wav, ogg, m4a…</p>
      </div>

      {/* Grabar / capturar en vivo */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            onClick={startMicRecording}
            disabled={capturing}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            🎙️ Grabar
          </button>
        ) : (
          <button
            onClick={stopMicRecording}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Detener · {formatDuration(recordingSeconds)}
          </button>
        )}

        {!capturing ? (
          <button
            onClick={startMeetingCapture}
            disabled={recording}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            🖥️ Capturar reunión
          </button>
        ) : (
          <button
            onClick={stopMeetingCapture}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Detener · {formatDuration(captureSeconds)}
          </button>
        )}
      </div>
      {capturing && (
        <p className="mt-1 text-xs text-slate-400">
          Recordá tildar &quot;Compartir audio de la pestaña&quot; en el diálogo del navegador (ej. con Google Meet
          abierto en otra pestaña).
        </p>
      )}
      {recordError && <p className="mt-2 text-sm text-red-600">{recordError}</p>}
      {captureError && <p className="mt-2 text-sm text-red-600">{captureError}</p>}

      {/* Cola de audios */}
      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <StatusDot status={it.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{it.file.name}</p>
                <p className="text-xs text-slate-400">
                  {formatFileSize(it.file.size)}
                  {it.status === "duplicate" && " · ya estaba guardado"}
                  {it.status === "error" && ` · ${it.error}`}
                </p>
              </div>
              {(it.status === "done" || it.status === "duplicate") && it.resultId && (
                <Link href={`/app/t/${it.resultId}`} className="text-xs font-semibold text-indigo-600 hover:underline">
                  Ver
                </Link>
              )}
              {it.status === "pending" && !running && (
                <button
                  onClick={() => removeItem(it.key)}
                  className="text-slate-300 hover:text-red-500"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Derivación a la app de escritorio para archivos grandes (límite de Vercel) */}
      {hasOversize && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Algunos audios pesan más de 4,5 MB y la web no los soporta.{" "}
          <Link href="/descargar" className="font-semibold underline hover:text-amber-900">
            Descargá la app de escritorio
          </Link>{" "}
          para sincronizar archivos grandes sin límite.
        </div>
      )}

      {topError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{topError}</p>}

      {/* Acción principal */}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={run}
          disabled={running || pendingCount === 0}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {running
            ? "Transcribiendo…"
            : pendingCount > 0
              ? `Transcribir ${pendingCount} audio${pendingCount > 1 ? "s" : ""}`
              : "Transcribir"}
        </button>
        {allDone && (
          <Link href={dashboardHref} className="text-sm font-semibold text-indigo-600 hover:underline">
            {doneCount > 0 ? `Ver ${doneCount} en el dashboard →` : "Ir al dashboard →"}
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    pending: { label: "⏳", cls: "" },
    working: { label: "🔄", cls: "animate-pulse" },
    done: { label: "✅", cls: "" },
    duplicate: { label: "⏭️", cls: "" },
    error: { label: "❌", cls: "" },
  };
  const s = map[status];
  return <span className={`text-lg leading-none ${s.cls}`}>{s.label}</span>;
}
