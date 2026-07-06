"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { formatDate } from "@/lib/format";
import {
  assignTranscriptionToProject,
  deleteTranscription,
  createProject,
} from "./actions";

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  text: string;
  icon: string;
  created_at: string;
  project_id: string | null;
};
type Project = { id: string; name: string; icon: string };

export function TranscriptionRow({
  transcription,
  projects,
}: {
  transcription: Transcription;
  projects: Project[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false); // borrado optimista

  const displayName = transcription.title || transcription.audio_name;

  async function moveTo(projectId: string | null) {
    setBusy(true);
    await assignTranscriptionToProject(transcription.id, projectId);
    setBusy(false);
    router.refresh();
  }

  async function moveToNew() {
    const name = window.prompt("Nombre del proyecto nuevo:");
    if (!name?.trim()) return;
    const fd = new FormData();
    fd.set("name", name);
    fd.set("icon", "📁");
    const res = await createProject(fd);
    if (res.ok) {
      await assignTranscriptionToProject(transcription.id, res.id);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm("¿Borrar esta transcripción? También se borra su audio. No se puede deshacer.")) return;
    setHidden(true); // feedback inmediato
    const res = await deleteTranscription(transcription.id);
    if (res.ok) {
      router.refresh();
    } else {
      setHidden(false); // si falla, la volvemos a mostrar
      alert(res.error ?? "No se pudo borrar.");
    }
  }

  if (hidden) return null;

  return (
    <li
      className={`flex items-stretch gap-1 rounded-xl border border-slate-200 bg-white transition hover:border-indigo-300 hover:shadow-sm ${
        busy ? "opacity-50" : ""
      }`}
    >
      <Link href={`/app/t/${transcription.id}`} className="block min-w-0 flex-1 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="truncate font-semibold text-slate-800">
            <span className="mr-1.5">{transcription.icon || "📄"}</span>
            {displayName}
          </p>
          <span className="shrink-0 text-xs text-slate-400">{formatDate(transcription.created_at)}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">
          {transcription.text || "(sin texto)"}
        </p>
      </Link>
      <div className="flex items-start p-2">
        <IconMenu label="Opciones de la transcripción">
          {(close) => (
            <>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Mover a
              </p>
              <div className="max-h-56 overflow-auto">
                <MenuItem onClick={() => { moveTo(null); close(); }}>
                  {transcription.project_id === null ? "✓ " : ""}📄 Sin proyecto
                </MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.id} onClick={() => { moveTo(p.id); close(); }}>
                    {transcription.project_id === p.id ? "✓ " : ""}
                    {p.icon || "📁"} {p.name}
                  </MenuItem>
                ))}
                <MenuItem onClick={() => { moveToNew(); close(); }}>＋ Proyecto nuevo…</MenuItem>
              </div>
              <div className="my-1 border-t border-slate-100" />
              <MenuItem danger onClick={() => { remove(); close(); }}>🗑️ Borrar</MenuItem>
            </>
          )}
        </IconMenu>
      </div>
    </li>
  );
}
