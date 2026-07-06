"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { EmojiPicker } from "./emoji-picker";
import { renameProject, duplicateProject, deleteProject } from "./actions";

type Project = { id: string; name: string; icon: string };

export function ProjectRow({
  project,
  count,
  active,
}: {
  project: Project;
  count: number;
  active: boolean;
}) {
  const router = useRouter();
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
      router.refresh();
    }
  }

  async function duplicate() {
    await duplicateProject(project.id);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`¿Borrar el proyecto "${project.name}"? Las transcripciones NO se borran, quedan sin proyecto.`))
      return;
    await deleteProject(project.id);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-1.5 py-1.5">
        <EmojiPicker value={icon} onChange={setIcon} />
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          onClick={saveRename}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
        >
          OK
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pr-1 ${
        active ? "bg-indigo-50" : "hover:bg-slate-100"
      }`}
    >
      <Link
        href={`/app?project=${project.id}`}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-sm ${
          active ? "font-semibold text-indigo-700" : "text-slate-700"
        }`}
      >
        <span className="text-base leading-none">{project.icon || "📁"}</span>
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span className="shrink-0 text-xs text-slate-400">{count}</span>
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
