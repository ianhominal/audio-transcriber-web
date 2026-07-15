"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renameProject, updateProjectDescription } from "./actions";
import { EmojiPicker } from "./emoji-picker";
import { ProjectColorPicker } from "./project-color-picker";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { getProjectColor } from "@/lib/project-colors";
import { Icon } from "@/components/ui/icon";

type ProjectHeaderData = {
  id: string;
  name: string;
  icon: string;
  description: string;
  createdAt: string;
  syncOrigin?: string;
  color?: string | null;
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
  const [color, setColor] = useState<string | null>(project.color ?? null);
  const [savingName, setSavingName] = useState(false);
  const projectColor = getProjectColor(project.color);

  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(project.description);
  const [savingDesc, setSavingDesc] = useState(false);

  async function saveName() {
    setSavingName(true);
    const res = await renameProject(project.id, name, icon, color);
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
    <header className="overflow-hidden rounded-2xl border border-border bg-surface">
      {/* Franja de acento (Fase F2): mismo lenguaje visual que el borde izquierdo de `ProjectRow`
          en el sidebar, acá arriba porque el header es horizontal. Reusa las clases `dot` (fondo
          sólido) en vez de `border` para no teñir los otros 3 lados de la tarjeta. Solo se
          renderiza si hay color — un proyecto neutro queda EXACTAMENTE igual que antes (sin
          reservar espacio transparente que le cambiaría el alto). */}
      {projectColor && <div className={`h-1.5 w-full ${projectColor.dot}`} aria-hidden="true" />}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {editingName ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <EmojiPicker value={icon} onChange={setIcon} />
              <ProjectColorPicker value={color} onChange={setColor} />
              <input
                value={name}
                autoFocus
                aria-label="Nombre del proyecto"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="min-w-0 flex-1 rounded-md border border-border-strong px-2.5 py-1.5 text-xl font-bold text-foreground focus:border-accent"
              />
              <Button size="sm" onClick={saveName} loading={savingName}>
                OK
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingName(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-background"
                title="Editar nombre e ícono"
              >
                <span className="text-2xl leading-none">
                  {project.icon ? <span>{project.icon}</span> : <Icon name="folder" size={24} />}
                </span>
                <span className="truncate text-2xl font-bold tracking-tight text-foreground">{project.name}</span>
                {project.syncOrigin === "drive" && (
                  <span title="Sincronizado con Google Drive" className="text-sm">
                    <Icon name="drive" size={14} />
                  </span>
                )}
              </button>
              {/* Badge de color (Fase F2): combo bg+texto ya pensado con contraste light/dark (ver
                  `src/lib/project-colors.ts`) — nunca se usa como fondo full-bleed detrás de texto
                  de cuerpo, solo en este pill chico. */}
              {projectColor && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${projectColor.badge}`}
                >
                  {projectColor.label}
                </span>
              )}
            </div>
          )}
          <span className="shrink-0 pt-1.5 text-xs text-tertiary">Creado el {formatDate(project.createdAt)}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-tertiary">
          <span className="inline-flex items-center gap-1">
            <Icon name="folder" size={14} /> {subfolderCount} subcarpeta{subfolderCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="mic" size={14} /> {transcriptionCount} transcripci{transcriptionCount === 1 ? "ón" : "ones"}
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
                className="w-full resize-y rounded-lg border border-border-strong p-2.5 text-sm text-secondary focus:border-accent focus:outline-none"
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
              className="w-full rounded-lg px-1 py-1 text-left text-sm text-secondary transition hover:bg-background"
            >
              {project.description || (
                <span className="inline-flex items-center gap-1 text-tertiary">
                  <Icon name="plus" size={14} /> Agregar contexto o descripción…
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
