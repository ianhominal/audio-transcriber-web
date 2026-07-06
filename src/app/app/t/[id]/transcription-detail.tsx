"use client";

import { useState } from "react";
import { formatDate, formatFileSize } from "@/lib/format";
import {
  updateTranscriptionText,
  assignTranscriptionToProject,
  deleteTranscription,
} from "../../actions";

type Transcription = {
  id: string;
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
  const [text, setText] = useState(transcription.text);
  const [projectId, setProjectId] = useState<string | null>(transcription.project_id);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = text !== transcription.text;

  async function save() {
    setSaving(true);
    const res = await updateTranscriptionText(transcription.id, text);
    setSaving(false);
    setMsg(res.ok ? "Guardado ✓" : res.error ?? "Error");
    if (res.ok) transcription.text = text;
    setTimeout(() => setMsg(null), 2500);
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
    if (!confirm("¿Borrar esta transcripción? No se puede deshacer.")) return;
    await deleteTranscription(transcription.id);
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">{transcription.audio_name}</h1>
        <span className="text-xs text-slate-400">{formatDate(transcription.created_at)}</span>
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
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
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
