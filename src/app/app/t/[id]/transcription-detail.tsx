"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { formatDate, formatFileSize, buildMarkdownExport, slugifyFileName } from "@/lib/format";
import { requestGoogleDriveAccessToken, uploadMarkdownToDrive, DriveAuthError } from "@/lib/googleDrive";
import {
  updateTranscription,
  assignTranscriptionToProject,
  deleteTranscription,
} from "../../actions";
import { EmojiPicker } from "../../emoji-picker";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useViewportClamp } from "@/hooks/useViewportClamp";

const EXPORT_MENU_WIDTH = 256; // w-64

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  audio_size: number;
  audio_url: string | null;
  text: string;
  description: string;
  icon: string;
  language: string;
  model: string;
  project_id: string | null;
  created_at: string;
};

type Project = { id: string; name: string; icon: string };

export function TranscriptionDetail({
  transcription,
  projects,
  audioSrc,
}: {
  transcription: Transcription;
  projects: Project[];
  audioSrc: string | null;
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [title, setTitle] = useState(transcription.title);
  const [text, setText] = useState(transcription.text);
  const [description, setDescription] = useState(transcription.description);
  const [icon, setIcon] = useState(transcription.icon);
  // Baseline contra el que se compara "hay cambios sin guardar" (`dirty`). Se actualiza recién
  // cuando `save()` confirma éxito — NO se lee/escribe `transcription` (prop) directamente: mutar
  // props/argumentos de hook está prohibido (ver `react-hooks/immutability`).
  const [baseline, setBaseline] = useState({
    title: transcription.title,
    text: transcription.text,
    description: transcription.description,
    icon: transcription.icon,
  });
  const [projectId, setProjectId] = useState<string | null>(transcription.project_id);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingDrive, setExportingDrive] = useState(false);
  // Menú "Exportar": portal a `document.body` + clampeo al viewport (mismo patrón que `IconMenu`,
  // extraído a `useViewportClamp`) — antes era `absolute left-0 w-64` sin clamp, así que en
  // pantallas angostas (~360-390px) se salía por el borde derecho.
  const {
    coords: exportCoords,
    triggerRef: exportTriggerRef,
    panelRef: exportPanelRef,
  } = useViewportClamp(exportOpen, EXPORT_MENU_WIDTH, { align: "left" });

  useEffect(() => {
    if (!exportOpen) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (exportTriggerRef.current?.contains(target) || exportPanelRef.current?.contains(target)) return;
      setExportOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExportOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
    // Los refs son estables entre renders — no hace falta re-suscribir salvo que cambie `exportOpen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOpen]);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? null;

  // Hay cambio real si cambió el título, el texto, la descripción o el ícono respecto del baseline.
  const dirty =
    title !== baseline.title ||
    text !== baseline.text ||
    description !== baseline.description ||
    icon !== baseline.icon;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const res = await updateTranscription(transcription.id, { title, text, description, icon });
    setSaving(false);
    if (res.ok) {
      setBaseline({ title, text, description, icon });
      setJustSaved(true);
      toast("Guardado.", "success");
      setTimeout(() => setJustSaved(false), 2000);
      router.refresh(); // refresca la lista/título en el resto de la app
    } else {
      toast(res.error ?? "No se pudo guardar.", "error");
    }
  }

  async function changeProject(value: string) {
    const next = value === "" ? null : value;
    setProjectId(next);
    await assignTranscriptionToProject(transcription.id, next);
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${transcription.audio_name.replace(/\.[^.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadAudio() {
    if (!audioSrc) return;
    // La URL firmada es cross-origin: bajamos el blob para forzar la descarga.
    const resp = await fetch(audioSrc);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = transcription.audio_name || "audio";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    const md = buildMarkdownExport({
      title: title || transcription.audio_name,
      createdAt: transcription.created_at,
      projectName,
      text,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFileName(title || transcription.audio_name)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    toast("Exportado como Markdown.", "success");
  }

  async function exportDrive() {
    // Pide un access token de Drive ON-DEMAND con Google Identity Services (modelo de token), NO
    // con el login de Supabase: así no dependemos de su provider_token (frágil, no se refresca) ni
    // hace falta re-loguear a nadie. Ver investigación en el changelog del 2026-07-07.
    setExportOpen(false);
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    setExportingDrive(true);
    try {
      const accessToken = await requestGoogleDriveAccessToken(clientId);
      const md = buildMarkdownExport({
        title: title || transcription.audio_name,
        createdAt: transcription.created_at,
        projectName,
        text,
      });
      await uploadMarkdownToDrive({
        accessToken,
        fileName: `${slugifyFileName(title || transcription.audio_name)}.md`,
        content: md,
      });
      toast("Guardado en tu Google Drive.", "success");
    } catch (e) {
      const message =
        e instanceof DriveAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No se pudo exportar a Google Drive.";
      toast(message, "error");
    } finally {
      setExportingDrive(false);
    }
  }

  async function remove() {
    if (!confirm("¿Borrar esta transcripción? También se borra su audio. No se puede deshacer.")) return;
    const res = await deleteTranscription(transcription.id);
    if (res.ok) {
      router.push("/app");
      router.refresh();
    } else {
      toast(res.error ?? "No se pudo borrar.", "error");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <EmojiPicker value={icon} onChange={setIcon} />
          <div className="min-w-0 flex-1">
            {/* Título editable propio (independiente del nombre del archivo) */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={transcription.audio_name || "Sin título"}
              aria-label="Título de la transcripción"
              className="w-full rounded-md border border-transparent bg-transparent text-2xl font-bold tracking-tight text-slate-900 outline-none hover:border-slate-200 focus:border-brand-400 focus:bg-white"
            />
            <p className="mt-0.5 px-0.5 text-xs text-slate-500">🎵 {transcription.audio_name}</p>
          </div>
        </div>
        <span className="shrink-0 pt-2 text-xs text-slate-500">{formatDate(transcription.created_at)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {transcription.model && <Badge>{transcription.model}</Badge>}
        <Badge>{transcription.language}</Badge>
        {transcription.audio_size > 0 && <Badge>{formatFileSize(transcription.audio_size)}</Badge>}
      </div>

      {/* Descripción / notas */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Descripción o notas (opcional)…"
        aria-label="Descripción o notas"
        className="mt-4 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
      />

      {/* Reproductor: usa una URL firmada temporal (bucket privado). */}
      {audioSrc ? (
        <audio controls src={audioSrc} className="mt-4 w-full" />
      ) : (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          🎧 El audio de esta transcripción todavía no está guardado.
        </p>
      )}

      {/* Asignar a proyecto */}
      <div className="mt-5 flex items-center gap-2">
        <label htmlFor="project" className="text-sm text-slate-600">
          Proyecto:
        </label>
        <select
          id="project"
          value={projectId ?? ""}
          onChange={(e) => changeProject(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400"
        >
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ""}
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Texto editable */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        aria-label="Texto de la transcripción"
        className="mt-5 w-full resize-y rounded-xl border border-slate-300 p-4 text-slate-800 focus:border-brand-400 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty} loading={saving} variant={justSaved ? "success" : "primary"}>
          {saving ? "Guardando…" : justSaved ? "Guardado ✓" : "Guardar"}
        </Button>
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copiado ✓" : "Copiar"}
        </Button>
        <Button variant="secondary" onClick={download}>
          Descargar .txt
        </Button>
        {audioSrc && (
          <Button variant="secondary" onClick={downloadAudio}>
            Descargar audio
          </Button>
        )}
        <div className="relative">
          <button
            ref={exportTriggerRef}
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            className={buttonClasses({ variant: "secondary" })}
          >
            Exportar ▾
          </button>
          {exportOpen &&
            createPortal(
              <div
                ref={exportPanelRef}
                role="menu"
                style={{
                  position: "fixed",
                  top: exportCoords?.top ?? -9999,
                  left: exportCoords?.left ?? -9999,
                  width: EXPORT_MENU_WIDTH,
                  visibility: exportCoords ? "visible" : "hidden",
                }}
                // z-50: mismo nivel que IconMenu/EmojiPicker (ver jerarquía en
                // `components/ui/Modal.tsx`), para mantener una escala de z-index coherente entre
                // todos los popovers porteados de la app.
                className="z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
              >
                <button
                  role="menuitem"
                  onClick={exportMarkdown}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                >
                  📝 Obsidian / Markdown (.md)
                </button>
                <button
                  role="menuitem"
                  onClick={exportDrive}
                  disabled={exportingDrive}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {exportingDrive ? <Spinner size="xs" /> : "📤"} {exportingDrive ? "Exportando…" : "Google Drive"}
                </button>
              </div>,
              document.body
            )}
        </div>
        <Button variant="danger-outline" onClick={remove} className="ml-auto">
          Borrar
        </Button>
      </div>
    </div>
  );
}
