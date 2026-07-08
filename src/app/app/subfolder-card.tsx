"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { EmojiPicker } from "./emoji-picker";
import { renameProject, duplicateProject, deleteProject } from "./actions";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Subfolder = { id: string; name: string; icon: string; syncOrigin?: string };

/**
 * Tile de subcarpeta dentro del panel del explorador (estilo "carpeta" de un explorador de
 * archivos): ícono grande + nombre + conteo, con menú de acciones (renombrar/duplicar/eliminar)
 * reusando las mismas server actions que ya usa `ProjectRow` en el sidebar.
 */
export function SubfolderCard({
  folder,
  subfolderCount,
  transcriptionCount,
}: {
  folder: Subfolder;
  subfolderCount: number;
  transcriptionCount: number;
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [icon, setIcon] = useState(folder.icon || "📁");
  const [busy, setBusy] = useState(false);

  async function saveRename() {
    setBusy(true);
    const res = await renameProject(folder.id, name, icon);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      toast("Carpeta renombrada.", "success");
      router.refresh();
    } else {
      toast("No se pudo renombrar la carpeta.", "error");
    }
  }

  async function duplicate() {
    const res = await duplicateProject(folder.id);
    toast(res.ok ? "Carpeta duplicada." : "No se pudo duplicar la carpeta.", res.ok ? "success" : "error");
    router.refresh();
  }

  async function remove() {
    if (
      !confirm(
        `¿Mover "${folder.name}" a la papelera? Su contenido (subcarpetas y transcripciones) se mueve junto con ella.`
      )
    )
      return;
    const res = await deleteProject(folder.id);
    toast(res.ok ? "Carpeta eliminada." : "No se pudo eliminar la carpeta.", res.ok ? "success" : "error");
    router.refresh();
  }

  const metaParts: string[] = [];
  if (subfolderCount > 0) metaParts.push(`${subfolderCount} subcarpeta${subfolderCount === 1 ? "" : "s"}`);
  metaParts.push(`${transcriptionCount} transcripci${transcriptionCount === 1 ? "ón" : "ones"}`);

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl border border-brand-300 bg-brand-50/40 p-3">
        <EmojiPicker value={icon} onChange={setIcon} />
        <input
          value={name}
          autoFocus
          aria-label="Nombre de la carpeta"
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
    <div className="group relative flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm">
      <Link href={`/app?project=${folder.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xl">
          {folder.icon || "📁"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-slate-800">{folder.name}</span>
            {folder.syncOrigin === "drive" && (
              <span title="Sincronizado con Google Drive" className="shrink-0 text-xs leading-none">
                ☁️
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-slate-400">{metaParts.join(" · ")}</span>
        </span>
      </Link>
      <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <IconMenu label={`Opciones de ${folder.name}`}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  setEditing(true);
                  close();
                }}
              >
                ✏️ Renombrar
              </MenuItem>
              <MenuItem
                onClick={() => {
                  duplicate();
                  close();
                }}
              >
                📑 Duplicar
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  remove();
                  close();
                }}
              >
                🗑️ Eliminar
              </MenuItem>
            </>
          )}
        </IconMenu>
      </div>
    </div>
  );
}
