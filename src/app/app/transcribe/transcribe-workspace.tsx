"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProject } from "../actions";
import { EmojiPicker } from "../emoji-picker";
import {
  formatFileSize,
  formatDuration,
  formatRecordingFileName,
  defaultTitleFromFileName,
  normalizeQueueTitle,
  resolveQueueTitle,
} from "@/lib/format";
import { AUDIO_MIME_CANDIDATES, pickSupportedMimeType, extensionForMimeType, WEB_MAX_BYTES } from "@/lib/recording";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Icon, type IconName } from "@/components/ui/icon";
import { useToast } from "@/components/ui/Toast";
import { useTranscriptionDefaults } from "@/lib/settings/use-transcription-defaults";
import { useOverridableDefault } from "@/lib/settings/use-overridable-default";
import type { TranscriptionDefaults } from "@/lib/settings/user-settings";
import {
  TRANSLATION_LANGUAGES,
  DEFAULT_TRANSLATION_LANGUAGE,
  DEFAULT_TRANSCRIBE_MODE,
  type TranscribeMode,
  type TranslationLanguageCode,
} from "@/lib/translate/languages";

// Formatos que Groq/Whisper acepta nativamente (mp4/mpeg incluidos: extrae el audio del video).
const SUPPORTED = [
  ".mp3", ".wav", ".ogg", ".opus", ".m4a", ".mp4",
  ".mpeg", ".mpga", ".flac", ".webm",
];

// WEB_MAX_BYTES, AUDIO_MIME_CANDIDATES, pickSupportedMimeType, extensionForMimeType ahora viven en
// @/lib/recording — se comparten con `/app/capturar` (ver `capture-workspace.tsx`), que necesita
// exactamente la misma lógica de compat de MediaRecorder para su propio flujo de grabación.

type Project = { id: string; name: string; icon: string };
type Status = "pending" | "working" | "done" | "duplicate" | "error";
type Item = {
  key: string;
  file: File;
  status: Status;
  resultId?: string;
  error?: string;
  // Título editable en la cola. Para grabaciones (mic/captura) arranca en el automático, ej.
  // "Grabacion-1720368000000"; para archivos subidos arranca en `file.name`. En ambos casos el
  // usuario puede editarlo inline en la cola (click en el título) antes de transcribir — ver JSX
  // de la cola más abajo y `normalizeQueueTitle` en @/lib/format.
  //
  // Una vez que el ítem pasa a "done"/"duplicate", `run()` lo actualiza con el título que devolvió
  // `/api/transcribe` (el auto-generado por IA — paso 2.7 del route — o el ya guardado si era un
  // duplicado), vía `resolveQueueTitle` — bugfix UX 2026-07-11: antes la cola se quedaba mostrando
  // el nombre de archivo original aunque la IA ya hubiera generado un título mejor. Si ese paso
  // best-effort no corrió o falló, `resolveQueueTitle` mantiene el título que ya estaba acá.
  title: string;
  // Tags de tema auto-generados (mismo paso 2.7, best-effort). Ausente/vacío si el paso no corrió o
  // no encontró tags — nunca bloquea el render de la cola (ver chips condicionales en el JSX).
  tags?: string[];
};

let counter = 0;
const nextKey = () => `f${++counter}`;

export function TranscribeWorkspace({
  projects,
  initialProject = "",
  initialDefaults,
  hasVocabulary = false,
}: {
  projects: Project[];
  initialProject?: string;
  initialDefaults?: TranscriptionDefaults;
  // Vocabulario custom (ver ROADMAP.md): true si el usuario ya cargó al menos un término en
  // Ajustes → Vocabulario. Solo decide si se muestra el toggle de abajo — sin términos cargados no
  // hay nada que activar/desactivar, así que ni se renderiza (mismo criterio que `hasOversize`).
  hasVocabulary?: boolean;
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [destino, setDestino] = useState<string>(initialProject); // "" | projectId | "__new__"
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("📁");

  // Defaults persistentes de transcripción (Motor/Calidad/Idioma, ver ROADMAP.md ítem F1) +
  // override puntual: `useOverridableDefault` da, por campo, el valor efectivo (override si el
  // usuario tocó ESE selector para esta tanda, si no el default persistido), si coincide con el
  // default y las acciones restaurar/fijar-como-default — sin duplicar esa tripleta de estado por
  // cada selector. Ningún `useEffect` de sincronización: cuando el default revalida en background
  // (ver `useTranscriptionDefaults`) el nuevo valor fluye solo mientras no haya override activo.
  // Reemplaza el lazy-initializer que antes leía `localStorage.getItem("transcribe:language")`
  // directo: `useTranscriptionDefaults` ya lee esa clave como fallback de compat (ver
  // `src/lib/settings/local-cache.ts`), así que ningún usuario pierde su idioma elegido.
  const { defaults, save: saveDefaults } = useTranscriptionDefaults(initialDefaults);
  const languageField = useOverridableDefault(defaults.language, (value) => saveDefaults({ language: value }));
  const qualityField = useOverridableDefault(defaults.quality, (value) => saveDefaults({ quality: value }));

  const language = languageField.value;
  const model = qualityField.value;

  // Modo "Transcribir" vs "Transcribir y traducir con IA" (Fase F4, ver ROADMAP.md item 6) +
  // idioma destino. A propósito NO usa `useOverridableDefault`/defaults de F1 todavía: es una
  // elección puntual por tanda (arranca siempre en "Transcribir"), no un default persistente —
  // ver nota de alcance en el JSX más abajo.
  const [mode, setMode] = useState<TranscribeMode>(DEFAULT_TRANSCRIBE_MODE);
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguageCode>(DEFAULT_TRANSLATION_LANGUAGE);

  // Corrección con vocabulario custom (ver ROADMAP.md): activada por defecto cuando hay términos
  // cargados (`hasVocabulary`), con opción de desactivar puntualmente para esta tanda — igual que el
  // modo de traducción, es una elección por tanda, no un default persistente.
  const [useVocabulary, setUseVocabulary] = useState(true);

  const setLanguageAsDefault = async () => {
    try {
      await languageField.setAsDefault();
      toast("Idioma guardado como predeterminado.", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar la preferencia.", "error");
    }
  };

  const setQualityAsDefault = async () => {
    try {
      await qualityField.setAsDefault();
      toast("Calidad guardada como predeterminada.", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar la preferencia.", "error");
    }
  };

  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [topError, setTopError] = useState("");
  // Edición inline del título en la cola: `editingKey` es el ítem en edición (null = ninguno) y
  // `editDraft` el valor del <input> mientras se edita. Reemplaza el modal "Guardar grabación"
  // que se sacó por molesto/con pérdida de datos — ver comentario en `enqueueRecording`.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const runningRef = useRef(false); // guard SÍNCRONO contra doble-submit
  const inputRef = useRef<HTMLInputElement>(null);

  // Al terminar de grabar (mic o captura de reunión) la grabación se encola DIRECTO, igual que
  // un archivo subido a mano: usa el "Proyecto destino" ya elegido arriba (se resuelve recién en
  // `run()`, como cualquier ítem) y un título automático que el usuario puede renombrar después
  // desde el detalle de la transcripción. Antes existía un modal "Guardar grabación" que volvía a
  // preguntar el proyecto (redundante) y descartaba la grabación si se cerraba con click afuera/
  // Escape (pérdida de datos) — se eliminó.
  function enqueueRecording(file: File) {
    const title = defaultTitleFromFileName(file.name);
    setItems((prev) => [...prev, { key: nextKey(), file, status: "pending" as Status, title }]);
    toast(`"${title}" agregada a la cola.`, "success");
  }

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
      title: file.name,
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
        enqueueRecording(file);
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
        enqueueRecording(file);
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

  // Edición inline del título: click en el título de un ítem pendiente lo convierte en <input>.
  const startEditTitle = (item: Item) => {
    setEditDraft(item.title);
    setEditingKey(item.key);
  };
  const commitEditTitle = (item: Item) => {
    patch(item.key, { title: normalizeQueueTitle(editDraft, item.title) });
    setEditingKey(null);
  };
  const cancelEditTitle = () => setEditingKey(null);

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
      // Bugfix (review adversarial 2026-07-10, hallazgo MEDIUM #2): `destino` seguía en "__new__"
      // después de crear el proyecto, así que la PRÓXIMA tanda (o un segundo click) volvía a pasar
      // por esta rama y llamaba a `createProject` de nuevo con el mismo nombre → proyecto duplicado.
      // Apenas se resuelve el id real, lo reflejamos en el <select> — tras el `router.refresh()` de
      // más abajo el proyecto nuevo ya aparece en `projects` y el <select> lo resuelve normal.
      setDestino(res.id);
      setNewName("");
      setNewIcon("📁");
    } else if (destino) {
      projectId = destino;
    }

    // Procesar en serie (respeta la cuota de Groq y da progreso claro).
    let okCount = 0;
    let failCount = 0;
    // Transcripciones que se guardaron bien pero cuyo audio no se pudo subir a Storage (best-effort
    // con reintento en el server, ver /api/transcribe). No es un error de la transcripción en sí
    // (el texto está a salvo), así que no cuenta como `failCount` — se avisa aparte, una sola vez
    // por lote, para no tapar al usuario de toasts si sube varios audios juntos.
    let audioMissingCount = 0;
    // Cuántos ítems del lote pidieron traducción pero el LLM falló (best-effort: la transcripción
    // original igual se guardó, ver `translationWarning` en /api/transcribe) — mismo criterio de
    // "un solo aviso agrupado por lote" que `audioMissingCount`.
    let translationWarningCount = 0;
    // Cuántos ítems se transcribieron con OTRA calidad porque la pedida se quedó sin cuota diaria
    // (ver `qualityWarning`/paso 2-bis en /api/transcribe) — mismo criterio de "un solo aviso
    // agrupado por lote". El texto exacto lo arma el server (`qualityFallbackNotice`).
    let qualityWarning: string | null = null;
    let qualityWarningCount = 0;
    for (const item of toProcess) {
      // Los archivos grandes no pasan por la web (límite de Vercel): se derivan a la app.
      if (item.file.size > WEB_MAX_BYTES) {
        patch(item.key, {
          status: "error",
          error: "Muy grande para la web (+4,5 MB). Usá la app de escritorio.",
        });
        failCount++;
        continue;
      }
      patch(item.key, { status: "working", error: undefined });
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("language", language);
        form.append("model", model);
        form.append("mode", mode);
        if (mode === "translate") form.append("targetLanguage", targetLanguage);
        form.append("useVocabulary", String(useVocabulary));
        // Toda la cola (archivos subidos y grabaciones) hereda el mismo proyecto destino del
        // lote, elegido en el selector de arriba.
        if (projectId) form.append("projectId", projectId);
        if (item.title) form.append("title", item.title);

        const resp = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "No se pudo transcribir.");
        patch(item.key, {
          status: data.duplicate ? "duplicate" : "done",
          resultId: data.id ?? undefined,
          // Título auto-generado por IA (o el que ya tenía guardado si era un duplicado) — cae al
          // título que la cola ya mostraba si el server no mandó uno (ver `resolveQueueTitle`).
          title: resolveQueueTitle(data.title, item.title),
          tags: Array.isArray(data.tags) ? data.tags : undefined,
        });
        okCount++;
        if (!data.duplicate && data.audioStored === false) audioMissingCount++;
        if (!data.duplicate && data.translationWarning) translationWarningCount++;
        if (!data.duplicate && typeof data.qualityWarning === "string") {
          qualityWarningCount++;
          qualityWarning = data.qualityWarning;
        }
      } catch (e) {
        patch(item.key, { status: "error", error: e instanceof Error ? e.message : "Error." });
        failCount++;
      }
    }

    runningRef.current = false;
    setRunning(false);
    if (okCount > 0) {
      toast(`${okCount} audio${okCount > 1 ? "s" : ""} transcrito${okCount > 1 ? "s" : ""}.`, "success");
    }
    if (failCount > 0) {
      toast(`${failCount} audio${failCount > 1 ? "s" : ""} no se pudo${failCount > 1 ? "ieron" : ""} transcribir.`, "error");
    }
    // Aviso no bloqueante: el texto se guardó igual, pero el audio original no — ver comentario en
    // `audioMissingCount` más arriba. Usa el mismo mecanismo de toasts que el resto del flujo (sin
    // agregar ninguna librería nueva), con tono "info" porque no es un error de la operación.
    if (audioMissingCount > 0) {
      toast(
        audioMissingCount === 1
          ? "Se guardó la transcripción, pero el audio no se pudo subir. Podés volver a subir el audio más tarde."
          : `Se guardaron ${audioMissingCount} transcripciones, pero sus audios no se pudieron subir. Podés volver a subirlos más tarde.`,
        "info"
      );
    }
    if (translationWarningCount > 0) {
      toast(
        translationWarningCount === 1
          ? "No se pudo traducir un audio — se guardó igual la transcripción original."
          : `No se pudo traducir ${translationWarningCount} audios — se guardaron igual las transcripciones originales.`,
        "info"
      );
    }
    // Nunca cambiamos la calidad en silencio: la usuaria eligió una a propósito.
    if (qualityWarning) {
      toast(
        qualityWarningCount === 1
          ? qualityWarning
          : `${qualityWarning.replace(/\.$/, "")} (${qualityWarningCount} audios).`,
        "info"
      );
    }
    router.refresh(); // que el dashboard vea las nuevas
  }

  const dashboardHref = destino && destino !== "__new__" ? `/app?project=${destino}` : "/app";
  const doneCount = items.filter((i) => i.status === "done" || i.status === "duplicate").length;
  const allDone = items.length > 0 && items.every((i) => i.status !== "pending" && i.status !== "working");
  const hasOversize = items.some((i) => i.file.size > WEB_MAX_BYTES);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Nueva transcripción</h1>
        <Link href="/app" className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent">
          ← Volver
        </Link>
      </div>

      {/* Destino — siempre visible, para saber DÓNDE van a caer los audios */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <label htmlFor="destino" className="mb-1.5 block text-sm font-semibold text-secondary">
          Proyecto destino
        </label>
        <select
          id="destino"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent"
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
              aria-label="Nombre del proyecto nuevo"
              className="min-w-0 flex-1 rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
            />
          </div>
        )}

        {/* Opciones compactas */}
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-tertiary">Idioma</span>
            <select
              value={language}
              onChange={(e) => languageField.change(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2 focus:border-accent"
            >
              <option value="es">Español</option>
              <option value="en">Inglés</option>
              <option value="auto">Automático</option>
            </select>
            <DefaultAffordance
              isDefault={languageField.isDefault}
              saving={languageField.saving}
              onRestore={languageField.restore}
              onSetDefault={setLanguageAsDefault}
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-tertiary">Calidad</span>
            <select
              value={model}
              onChange={(e) => qualityField.change(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2 focus:border-accent"
            >
              <option value="whisper-large-v3-turbo">Rápida</option>
              <option value="whisper-large-v3">Máxima calidad</option>
            </select>
            <span className="mt-1 max-w-[12rem] text-[11px] text-tertiary">
              Rápida es ideal para audios largos; Máxima calidad prioriza la precisión.
            </span>
            <DefaultAffordance
              isDefault={qualityField.isDefault}
              saving={qualityField.saving}
              onRestore={qualityField.restore}
              onSetDefault={setQualityAsDefault}
            />
          </label>
        </div>

        {/* Modo: transcribir tal cual vs. transcribir + traducir el texto con un LLM (Fase F4).
            Separado con un borde superior propio para no mezclarse visualmente con Idioma/Calidad
            de arriba — esos son selectores con affordance de default de F1 (pill "Predeterminado" /
            "Modificado · restaurar"); esto es una elección puntual por tanda, sin esa affordance
            todavía (ver ROADMAP.md item 6/F4, "Pendiente" de integrar con los defaults). */}
        <div className="mt-4 border-t border-border pt-4">
          <span className="mb-1.5 block text-sm font-semibold text-secondary">Traducción</span>
          <div
            role="group"
            aria-label="Modo de transcripción"
            className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-secondary p-0.5"
          >
            <button
              type="button"
              aria-pressed={mode === "transcribe"}
              onClick={() => setMode("transcribe")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out ${
                mode === "transcribe" ? "bg-surface text-accent shadow-sm" : "text-tertiary hover:text-secondary"
              }`}
            >
              Transcribir
            </button>
            <button
              type="button"
              aria-pressed={mode === "translate"}
              onClick={() => setMode("translate")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out ${
                mode === "translate" ? "bg-surface text-accent shadow-sm" : "text-tertiary hover:text-secondary"
              }`}
            >
              Transcribir y traducir
            </button>
          </div>

          {mode === "translate" && (
            <div className="mt-2.5 max-w-xs">
              <label htmlFor="targetLanguage" className="mb-1 block text-xs font-semibold text-tertiary">
                Idioma destino
              </label>
              <select
                id="targetLanguage"
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value as TranslationLanguageCode)}
                className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent"
              >
                {TRANSLATION_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-tertiary">
                Se transcribe y después se traduce el texto con IA — revisá el resultado, puede tener errores.
              </p>
            </div>
          )}
        </div>

        {/* Vocabulario custom: corrección automática de nombres/jerga (feature diferencial #1, ver
            .claude/resources/BUSINESS.md). Solo se muestra si el usuario cargó al menos un término
            en Ajustes → Vocabulario — sin eso no hay nada que activar/desactivar. */}
        {hasVocabulary && (
          <div className="mt-4 border-t border-border pt-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary">
                <Icon name="vocabulary" className="shrink-0" />
                Corregir con tu vocabulario
              </span>
              <input
                type="checkbox"
                checked={useVocabulary}
                onChange={(e) => setUseVocabulary(e.target.checked)}
                aria-label="Corregir automáticamente con tu vocabulario"
                className="h-4 w-4 shrink-0 accent-accent"
              />
            </label>
            <p className="mt-1 text-xs text-tertiary">
              Corrige sola los nombres y términos de tu lista si quedaron mal en la transcripción.
            </p>
          </div>
        )}
      </div>

      {/* Dropzone múltiple */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Elegir o arrastrar audios para transcribir"
        className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragOver ? "border-accent bg-accent-subtle" : "border-border-strong bg-surface hover:border-accent hover:bg-background"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED.join(",")}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p aria-hidden="true">
          <Icon name="upload" size={24} className="mx-auto" />
        </p>
        <p className="mt-2 font-medium text-secondary">Arrastrá tus audios acá</p>
        <p className="mt-1 text-sm text-tertiary">
          o hacé clic para elegirlos · podés cargar varios · mp3, wav, ogg, m4a…
        </p>
      </div>

      {/* Grabar / capturar en vivo */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!recording ? (
          <Button
            type="button"
            variant="secondary"
            onClick={startMicRecording}
            disabled={capturing}
          >
            <Icon name="mic" className="shrink-0" />
            Grabar
          </Button>
        ) : (
          <Button type="button" variant="danger" onClick={stopMicRecording}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Detener · {formatDuration(recordingSeconds)}
          </Button>
        )}

        {!capturing ? (
          <Button
            type="button"
            variant="secondary"
            onClick={startMeetingCapture}
            disabled={recording}
          >
            <Icon name="capture" className="shrink-0" />
            Capturar reunión
          </Button>
        ) : (
          <Button type="button" variant="danger" onClick={stopMeetingCapture}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
            Detener · {formatDuration(captureSeconds)}
          </Button>
        )}
      </div>
      {capturing && (
        <p className="mt-1 text-xs text-tertiary">
          Recordá tildar &quot;Compartir audio de la pestaña&quot; en el diálogo del navegador (ej. con Google Meet
          abierto en otra pestaña).
        </p>
      )}
      {recordError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{recordError}</p>}
      {captureError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{captureError}</p>}

      {/* Cola de audios. El <ul> se renderiza SIEMPRE (bugfix LOW #12, review adversarial
          2026-07-10): antes vivía detrás de `{items.length > 0 && (...)}`, así que la región
          `aria-live` recién se montaba con el PRIMER ítem ya adentro — un lector de pantalla nunca
          llega a anunciar esa primera inserción porque la región todavía no existía cuando ocurrió.
          Pre-existiendo vacía, la primera inserción sí dispara el anuncio. El espaciado (`mt-4`)
          queda condicional para no dejar un margen huérfano cuando la cola está vacía. */}
      <ul className={`space-y-2 ${items.length > 0 ? "mt-4" : ""}`} aria-live="polite">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <StatusDot status={it.status} />
            <div className="min-w-0 flex-1">
              {/* Título editable inline mientras el ítem está pendiente: un click lo convierte
                  en <input> (sin modal — ver comentario en `enqueueRecording`). Enter/blur
                  confirma, Escape cancela. Aplica igual a grabaciones y archivos subidos. */}
              {editingKey === it.key ? (
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitEditTitle(it)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEditTitle(it);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEditTitle();
                    }
                  }}
                  aria-label={`Editar título de ${it.title}`}
                  className="w-full min-w-0 rounded-md border border-accent px-2 py-1 text-sm font-medium text-foreground focus:outline-none"
                />
              ) : it.status === "pending" && !running ? (
                <button
                  type="button"
                  onClick={() => startEditTitle(it)}
                  className="group flex max-w-full items-center gap-1.5 text-left"
                  aria-label={`Editar título de ${it.title}`}
                >
                  <span className="truncate text-sm font-medium text-foreground transition-colors duration-150 ease-out group-hover:text-accent">
                    {it.title}
                  </span>
                  <Icon
                    name="edit"
                    size={12}
                    className="shrink-0 text-tertiary transition-colors duration-150 ease-out group-hover:text-accent"
                  />
                </button>
              ) : (
                <p className="truncate text-sm font-medium text-foreground">{it.title}</p>
              )}
              <p className="text-xs text-tertiary">
                {formatFileSize(it.file.size)}
                {it.status === "duplicate" && " · ya estaba guardado"}
                {it.status === "error" && ` · ${it.error}`}
              </p>
              {/* Tags de tema auto-generados (mismo paso 2.7 de /api/transcribe que el título) —
                  solo una vez terminado el ítem y si el best-effort encontró alguno. Mismo tono
                  visual que los chips de `transcription-row.tsx`/el detalle (`accent-subtle`), pero
                  sin <Link>: acá es solo lectura, filtrar por tag ya existe desde el dashboard. */}
              {(it.status === "done" || it.status === "duplicate") && it.tags && it.tags.length > 0 && (
                <ul aria-label="Etiquetas" role="list" className="mt-1 flex flex-wrap gap-1">
                  {it.tags.map((tag) => (
                    <li
                      key={tag}
                      className="inline-flex items-center rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] font-medium text-accent-subtle-text"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {(it.status === "done" || it.status === "duplicate") && it.resultId && (
              <Link href={`/app/t/${it.resultId}`} className="text-xs font-semibold text-accent hover:underline">
                Ver
              </Link>
            )}
            {it.status === "pending" && !running && editingKey !== it.key && (
              <button
                type="button"
                onClick={() => removeItem(it.key)}
                className="tap-target flex shrink-0 items-center justify-center rounded text-tertiary transition hover:text-red-500"
                aria-label={`Quitar ${it.title} de la cola`}
              >
                <Icon name="close" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Derivación a la app de escritorio para archivos grandes (límite de Vercel) */}
      {hasOversize && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200">
          <Icon name="warning" className="mt-0.5 shrink-0" />
          <p>
            Algunos audios pesan más de 4,5 MB y la web no los soporta.{" "}
            <Link href="/descargar" className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-100">
              Descargá la app de escritorio
            </Link>{" "}
            para sincronizar archivos grandes sin límite.
          </p>
        </div>
      )}

      {topError && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-400/15 dark:text-red-200"
        >
          {topError}
        </p>
      )}

      {/* Acción principal */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={run} loading={running} disabled={pendingCount === 0} size="lg">
          {running
            ? "Transcribiendo…"
            : pendingCount > 0
              ? `Transcribir ${pendingCount} audio${pendingCount > 1 ? "s" : ""}`
              : "Transcribir"}
        </Button>
        {allDone && (
          <Link href={dashboardHref} className="text-sm font-semibold text-accent hover:underline">
            {doneCount > 0 ? `Ver ${doneCount} en el dashboard →` : "Ir al dashboard →"}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Affordance estilo VS Code Settings: pill "Predeterminado" cuando el selector coincide con el
 * default guardado, o "Modificado · restaurar" + "Guardar como predeterminado" cuando se cambió
 * solo para esta tanda (override puntual, ver `TranscribeWorkspace`) — el estado
 * default-vs-cambiado queda siempre visible, sin que el usuario tenga que adivinarlo. Texto
 * invariable en género (concuerda con "valor", no con "Idioma"/"Calidad"): el componente es
 * compartido por ambos selectores, así que no puede hardcodear un género específico.
 */
function DefaultAffordance({
  isDefault,
  saving,
  onRestore,
  onSetDefault,
}: {
  isDefault: boolean;
  saving: boolean;
  onRestore: () => void;
  onSetDefault: () => void;
}) {
  if (isDefault) {
    return (
      <span className="mt-1 inline-flex w-fit items-center rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-tertiary">
        Predeterminado
      </span>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
      <button type="button" onClick={onRestore} className="font-medium text-accent hover:underline">
        Modificado · restaurar
      </button>
      <span className="text-tertiary" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        onClick={onSetDefault}
        disabled={saving}
        className="font-medium text-accent hover:underline disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar como predeterminado"}
      </button>
    </span>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "working") return <Spinner size="sm" className="shrink-0 text-accent" />;
  const map: Record<Exclude<Status, "working">, { name: IconName; cls: string }> = {
    pending: { name: "pending", cls: "text-amber-500" },
    done: { name: "success", cls: "text-emerald-500" },
    duplicate: { name: "skip", cls: "text-tertiary" },
    error: { name: "error", cls: "text-red-500" },
  };
  const s = map[status];
  return <Icon name={s.name} className={`shrink-0 ${s.cls}`} />;
}
