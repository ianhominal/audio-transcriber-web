"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { EmojiPicker } from "./emoji-picker";
import { ProjectColorPicker } from "./project-color-picker";
import { renameProject, duplicateProject, deleteProject, assignTranscriptionToProject } from "./actions";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getProjectColor } from "@/lib/project-colors";
import { Icon } from "@/components/ui/icon";
import {
  TRANSCRIPTION_DRAG_MIME,
  decodeTranscriptionDragPayload,
  resolveTranscriptionDrop,
} from "@/lib/dnd/transcriptionDrag";

type Project = { id: string; name: string; icon: string; syncOrigin?: string; color?: string | null };

// Tope de indentación visual: a partir de esta profundidad, los niveles siguientes ya no suman
// más `padding-left` — un árbol muy anidado en mobile (~360px) podía comerse todo el ancho
// disponible y dejar la fila sin espacio para el nombre/conteo/menú.
const MAX_INDENT_DEPTH = 4;

export function ProjectRow({
  project,
  count,
  active,
  depth = 0,
  hasChildren = false,
  expanded = true,
  onToggleExpand,
  knownProjectIds = [],
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
  /** Ids de todos los proyectos del usuario, para validar el destino de un drop (drag & drop). */
  knownProjectIds?: readonly string[];
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [icon, setIcon] = useState(project.icon || "📁");
  const [color, setColor] = useState<string | null>(project.color ?? null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const projectColor = getProjectColor(project.color);

  /** Mecanismo 1 (drag & drop) de mover una transcripción a este proyecto: soltarla acá cambia su
   * `project_id` reusando la misma server action que el menú "..." de la fila (mecanismo 2). */
  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(TRANSCRIPTION_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(TRANSCRIPTION_DRAG_MIME)) return;
    e.preventDefault();
    setDragOver(false);
    const payload = decodeTranscriptionDragPayload(e.dataTransfer.getData(TRANSCRIPTION_DRAG_MIME));
    if (!payload) return;
    const resolution = resolveTranscriptionDrop(payload, project.id, knownProjectIds);
    if (!resolution.shouldMove) return;
    const res = await assignTranscriptionToProject(resolution.id, resolution.projectId);
    toast(res.ok ? `Movido a ${project.name}.` : "No se pudo mover la transcripción.", res.ok ? "success" : "error");
    router.refresh();
  }

  async function saveRename() {
    setBusy(true);
    const res = await renameProject(project.id, name, icon, color);
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
        style={{ paddingLeft: Math.min(depth, MAX_INDENT_DEPTH) * 16 }}
        className="flex items-center gap-1.5 rounded-lg bg-background px-1.5 py-1.5"
      >
        <EmojiPicker value={icon} onChange={setIcon} />
        <ProjectColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          autoFocus
          aria-label="Nombre del proyecto"
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
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // Borde izquierdo de acento (Fase F2): solo se agrega `border-l-4` cuando el proyecto TIENE
      // color — mismo criterio que `ProjectHeader` (ver ese archivo) — para que un proyecto
      // neutro no reserve espacio de layout: un `border-l-4 border-transparent` igual resta 4px
      // al content-box y desalinea filas coloreadas vs. neutras dentro de la misma lista.
      className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
        projectColor ? `border-l-4 ${projectColor.border}` : ""
      } ${active ? "bg-accent-subtle" : "hover:bg-surface-secondary"} ${
        dragOver ? "bg-accent-subtle ring-2 ring-inset ring-accent" : ""
      }`}
    >
      <Link
        href={`/app?project=${project.id}`}
        style={{ paddingLeft: 10 + Math.min(depth, MAX_INDENT_DEPTH) * 16 }}
        className={`flex min-w-0 flex-1 items-center gap-2 py-2 pr-2.5 text-sm ${
          active ? "font-semibold text-accent-subtle-text" : "text-secondary"
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
            // Hit-slop: el glyph queda visualmente chico (no se agranda el ícono, que rompería la
            // densidad de la lista), pero el área táctil real llega a 44px vía margen negativo —
            // mismo criterio que pide el ítem de touch targets sin inflar el layout.
            className="tap-target -m-3 flex shrink-0 items-center justify-center rounded text-tertiary transition-colors duration-150 ease-out hover:text-secondary"
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} />
          </button>
        ) : depth > 0 ? (
          <span className="w-3.5 shrink-0" />
        ) : null}
        <span className="shrink-0">{project.icon ? <span>{project.icon}</span> : <Icon name="folder" />}</span>
        {projectColor && (
          <span
            title={projectColor.label}
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${projectColor.dot}`}
          />
        )}
        {project.syncOrigin === "drive" && (
          <span title="Sincronizado con Google Drive" className="shrink-0 text-xs leading-none">
            <Icon name="drive" size={14} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-tertiary">{count}</span>
      </Link>
      <IconMenu label={`Opciones de ${project.name}`}>
        {(close) => (
          <>
            <MenuItem onClick={() => { setEditing(true); close(); }}>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="edit" /> Renombrar
              </span>
            </MenuItem>
            <MenuItem onClick={() => { duplicate(); close(); }}>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="duplicate" /> Duplicar
              </span>
            </MenuItem>
            <MenuItem danger onClick={() => { remove(); close(); }}>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="delete" /> Eliminar
              </span>
            </MenuItem>
          </>
        )}
      </IconMenu>
    </div>
  );
}
