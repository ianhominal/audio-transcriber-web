"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renameProject, updateProjectDescription } from "./actions";
import { EmojiPicker } from "./emoji-picker";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type ProjectHeaderData = {
  id: string;
  name: string;
  icon: string;
  description: string;
  createdAt: string;
  syncOrigin?: string;
};

/**
 * Cabecera del explorador jerárquico: nombre + ícono editables inline, contexto/descripción
 * editable inline (columna `description`, existe desde el esquema inicial — sin problema de
 * compat), fecha de creación y conteos (subcarpetas · transcripciones) de ESTE nivel.
 */
export function ProjectHeader({
  project,
  subfolderCount,
  transcriptionCount,
}: {
  project: ProjectHeaderData;
  subfolderCount: number;
  transcriptionCount: number;
}) {
  const router = useRouter();
  const { show: toast } = useToast();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const [icon, setIcon] = useState(project.icon || "📁");
  const [savingName, setSavingName] = useState(false);

  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(project.description);
  const [savingDesc, setSavingDesc] = useState(false);

  async function saveName() {
    setSavingName(true);
    const res = await renameProject(project.id, name, icon);
    setSavingName(false);
    if (res.ok) {
      setEditingName(false);
      toast("Proyecto renombrado.", "success");
      router.refresh();
    } else {
      toast("No se pudo renombrar el proyecto.", "error");
    }
  }

  async function saveDescription() {
    setSavingDesc(true);
    const res = await updateProjectDescription(project.id, description);
    setSavingDesc(false);
    if (res.ok) {
      setEditingDesc(false);
      toast("Contexto guardado.", "success");
      router.refresh();
    } else {
      toast("No se pudo guardar el contexto.", "error");
    }
  }

  return (
    <header className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {editingName ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <EmojiPicker value={icon} onChange={setIcon} />
            <input
              value={name}
              autoFocus
              aria-label="Nombre del proyecto"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xl font-bold text-slate-900 focus:border-brand-400"
            />
            <Button size="sm" onClick={saveName} loading={savingName}>
              OK
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditingName(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-slate-50"
            title="Editar nombre e ícono"
          >
            <span className="text-2xl leading-none">{project.icon || "📁"}</span>
            <span className="truncate text-2xl font-bold tracking-tight text-slate-900">{project.name}</span>
            {project.syncOrigin === "drive" && (
              <span title="Sincronizado con Google Drive" className="text-sm">
                ☁️
              </span>
            )}
          </button>
        )}
        <span className="shrink-0 pt-1.5 text-xs text-slate-500">Creado el {formatDate(project.createdAt)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-slate-500">
        <span>
          📁 {subfolderCount} subcarpeta{subfolderCount === 1 ? "" : "s"}
        </span>
        <span>
          🎙️ {transcriptionCount} transcripci{transcriptionCount === 1 ? "ón" : "ones"}
        </span>
      </div>

      <div className="mt-3">
        {editingDesc ? (
          <div className="space-y-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Contexto o descripción del proyecto…"
              aria-label="Contexto o descripción del proyecto"
              className="w-full resize-y rounded-lg border border-slate-300 p-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveDescription} loading={savingDesc}>
                Guardar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDescription(project.description);
                  setEditingDesc(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDesc(true)}
            className="w-full rounded-lg px-1 py-1 text-left text-sm text-slate-600 transition hover:bg-slate-50"
          >
            {project.description || <span className="text-slate-500">+ Agregar contexto o descripción…</span>}
          </button>
        )}
      </div>
    </header>
  );
}
