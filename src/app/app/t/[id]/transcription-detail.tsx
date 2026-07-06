"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatFileSize } from "@/lib/format";
import {
  updateTranscription,
  assignTranscriptionToProject,
  deleteTranscription,
} from "../../actions";

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  audio_size: number;
  audio_url: string | null;
  text: string;
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
  const [title, setTitle] = useState(transcription.title);
  const [text, setText] = useState(transcription.text);
  const [projectId, setProjectId] = useState<string | null>(transcription.project_id);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Hay cambio real si cambió el título O el texto.
  const dirty = title !== transcription.title || text !== transcription.text;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setMsg(null);
    const res = await updateTranscription(transcription.id, title, text);
    setSaving(false);
    if (res.ok) {
      transcription.title = title;
      transcription.text = text;
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      router.refresh(); // refresca la lista/título en el resto de la app
    } else {
      setMsg(res.error ?? "No se pudo guardar.");
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

  async function remove() {
    if (!confirm("¿Borrar esta transcripción? También se borra su audio. No se puede deshacer.")) return;
    const res = await deleteTranscription(transcription.id);
    if (res.ok) {
      router.push("/app");
      router.refresh();
    } else {
      setMsg(res.error ?? "No se pudo borrar.");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Título editable propio (independiente del nombre del archivo) */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={transcription.audio_name || "Sin título"}
            aria-label="Título de la transcripción"
            className="w-full rounded-md border border-transparent bg-transparent text-2xl font-bold text-slate-900 outline-none hover:border-slate-200 focus:border-indigo-400 focus:bg-white"
          />
          <p className="mt-0.5 px-0.5 text-xs text-slate-400">🎵 {transcription.audio_name}</p>
        </div>
        <span className="shrink-0 pt-2 text-xs text-slate-400">{formatDate(transcription.created_at)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {transcription.model && <Badge>{transcription.model}</Badge>}
        <Badge>{transcription.language}</Badge>
        {transcription.audio_size > 0 && <Badge>{formatFileSize(transcription.audio_size)}</Badge>}
      </div>

      {/* Reproductor: usa una URL firmada temporal (bucket privado). */}
      {audioSrc ? (
        <audio controls src={audioSrc} className="mt-4 w-full" />
      ) : (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
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
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
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
        className="mt-5 w-full resize-y rounded-xl border border-slate-300 p-4 text-slate-800 focus:border-indigo-400 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
            justSaved
              ? "bg-emerald-600"
              : "bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          }`}
        >
          {saving ? "Guardando…" : justSaved ? "Guardado ✓" : "Guardar"}
        </button>
        <button
          onClick={copy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? "Copiado ✓" : "Copiar"}
        </button>
        <button
          onClick={download}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Descargar .txt
        </button>
        {audioSrc && (
          <button
            onClick={downloadAudio}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Descargar audio
          </button>
        )}
        <button
          onClick={remove}
          className="ml-auto rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Borrar
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}
