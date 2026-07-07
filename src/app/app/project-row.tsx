"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { EmojiPicker } from "./emoji-picker";
import { renameProject, duplicateProject, deleteProject } from "./actions";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Project = { id: string; name: string; icon: string; syncOrigin?: string };

export function ProjectRow({
  project,
  count,
  active,
  depth = 0,
  hasChildren = false,
  expanded = true,
  onToggleExpand,
}: {
  project: Project;
  count: number;
  active: boolean;
  /** Nivel de anidamiento (0 = raíz). Solo lo usan los proyectos de Drive con jerarquía (doc 10); los locales siempre son 0. */
  depth?: number;
  /** `true` si tiene subproyectos — muestra el chevron para colapsar/expandir. */
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [icon, setIcon] = useState(project.icon || "📁");
  const [busy, setBusy] = useState(false);

  async function saveRename() {
    setBusy(true);
    const res = await renameProject(project.id, name, icon);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      toast("Proyecto renombrado.", "success");
      router.refresh();
    } else {
      toast("No se pudo renombrar el proyecto.", "error");
    }
  }

  async function duplicate() {
    const res = await duplicateProject(project.id);
    toast(res.ok ? "Proyecto duplicado." : "No se pudo duplicar el proyecto.", res.ok ? "success" : "error");
    router.refresh();
  }

  async function remove() {
    if (!confirm(`¿Borrar el proyecto "${project.name}"? Las transcripciones NO se borran, quedan sin proyecto.`))
      return;
    const res = await deleteProject(project.id);
    toast(res.ok ? "Proyecto eliminado." : "No se pudo eliminar el proyecto.", res.ok ? "success" : "error");
    router.refresh();
  }

  if (editing) {
    return (
      <div
        style={{ paddingLeft: depth * 16 }}
        className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-1.5 py-1.5"
      >
        <EmojiPicker value={icon} onChange={setIcon} />
        <input
          value={name}
          autoFocus
          aria-label="Nombre del proyecto"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-400"
        />
        <Button size="sm" onClick={saveRename} loading={busy} className="px-2.5 py-1">
          OK
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
        active ? "bg-brand-50" : "hover:bg-slate-100"
      }`}
    >
      <Link
        href={`/app?project=${project.id}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        className={`flex min-w-0 flex-1 items-center gap-2 py-2 pr-2.5 text-sm ${
          active ? "font-semibold text-brand-700" : "text-slate-700"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleExpand?.();
            }}
            aria-label={expanded ? `Colapsar ${project.name}` : `Expandir ${project.name}`}
            className="shrink-0 rounded text-slate-400 hover:text-slate-600"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : depth > 0 ? (
          <span className="w-3.5 shrink-0" />
        ) : null}
        <span className="text-base leading-none">{project.icon || "📁"}</span>
        {project.syncOrigin === "drive" && (
          <span title="Sincronizado con Google Drive" className="shrink-0 text-xs leading-none">
            ☁️
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{count}</span>
      </Link>
      <IconMenu label={`Opciones de ${project.name}`}>
        {(close) => (
          <>
            <MenuItem onClick={() => { setEditing(true); close(); }}>✏️ Renombrar</MenuItem>
            <MenuItem onClick={() => { duplicate(); close(); }}>📑 Duplicar</MenuItem>
            <MenuItem danger onClick={() => { remove(); close(); }}>🗑️ Eliminar</MenuItem>
          </>
        )}
      </IconMenu>
    </div>
  );
}
