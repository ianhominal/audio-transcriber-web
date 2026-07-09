"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { EmojiPicker } from "./emoji-picker";
import { ProjectColorPicker } from "./project-color-picker";
import { renameProject, duplicateProject, deleteProject } from "./actions";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getProjectColor } from "@/lib/project-colors";

type Subfolder = { id: string; name: string; icon: string; syncOrigin?: string; color?: string | null };

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
  const [color, setColor] = useState<string | null>(folder.color ?? null);
  const [busy, setBusy] = useState(false);
  const folderColor = getProjectColor(folder.color);

  async function saveRename() {
    setBusy(true);
    const res = await renameProject(folder.id, name, icon, color);
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
      <div className="flex items-center gap-1.5 rounded-xl border border-accent bg-accent-subtle p-3">
        <EmojiPicker value={icon} onChange={setIcon} />
        <ProjectColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          autoFocus
          aria-label="Nombre de la carpeta"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-border-strong px-2 py-1 text-sm focus:border-accent"
        />
        <Button size="sm" onClick={saveRename} loading={busy} className="px-2.5 py-1">
          OK
        </Button>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition hover:border-accent hover:shadow-sm">
      <Link href={`/app?project=${folder.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-xl">
          {folder.icon || "📁"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-foreground">{folder.name}</span>
            {folderColor && (
              <span
                title={folderColor.label}
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${folderColor.dot}`}
              />
            )}
            {folder.syncOrigin === "drive" && (
              <span title="Sincronizado con Google Drive" className="shrink-0 text-xs leading-none">
                ☁️
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-tertiary">{metaParts.join(" · ")}</span>
        </span>
      </Link>
      {/* En touch no hay `:hover`, así que `opacity-0 group-hover:opacity-100` dejaba el menú
          inalcanzable en mobile (nunca se disparaba). Abajo de `md` queda siempre visible; de
          `md` para arriba (mouse/trackpad) se mantiene el comportamiento original de hover. */}
      <div className="opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
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
