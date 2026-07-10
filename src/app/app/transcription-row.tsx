"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMenu, MenuItem } from "./icon-menu";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  assignTranscriptionToProject,
  deleteTranscription,
  createProject,
} from "./actions";
import {
  TRANSCRIPTION_DRAG_MIME,
  encodeTranscriptionDragPayload,
} from "@/lib/dnd/transcriptionDrag";

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
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false); // borrado optimista
  const [dragging, setDragging] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPending, setNewProjectPending] = useState(false);
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  // Elemento a devolverle el foco cuando cierra el modal "Proyecto nuevo…". No podemos confiar en
  // el `document.activeElement` que lee el propio `Modal` al montarse: el `MenuItem` que abre este
  // modal vive en el popover porteado de `IconMenu`, que se desmonta en el MISMO commit que abre
  // el modal (`setNewProjectOpen(true); close();`) — para cuando el efecto del Modal corre, el
  // activeElement ya es `document.body`. Lo capturamos acá, ANTES de ese desmontaje, apuntando al
  // botón "..." (el trigger de IconMenu, todavía montado en este momento) y lo restauramos
  // nosotros mismos en el efecto de abajo.
  const newProjectRestoreFocusRef = useRef<HTMLElement | null>(null);

  const displayName = transcription.title || transcription.audio_name;

  /** Arranca el drag & drop nativo (mecanismo 1: arrastrar la fila a un proyecto del sidebar). El
   * menú "..." (`moveTo` de abajo) es la alternativa accesible para quien no puede arrastrar. */
  function handleDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData(
      TRANSCRIPTION_DRAG_MIME,
      encodeTranscriptionDragPayload({ id: transcription.id, projectId: transcription.project_id })
    );
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  async function moveTo(projectId: string | null, projectName: string) {
    setBusy(true);
    const res = await assignTranscriptionToProject(transcription.id, projectId);
    setBusy(false);
    toast(res.ok ? `Movido a ${projectName}.` : "No se pudo mover la transcripción.", res.ok ? "success" : "error");
    router.refresh();
  }

  function closeNewProjectModal() {
    setNewProjectOpen(false);
    setNewProjectName("");
    setNewProjectError(null);
  }

  // Restaura el foco al botón "..." apenas se cierra el modal (ver comentario en
  // `newProjectRestoreFocusRef` más arriba). Corre en el mismo commit en que el Modal se
  // desmonta, DESPUÉS de que corra el cleanup del propio focus-trap del Modal (React ejecuta
  // todos los cleanups de efectos pasivos antes que los efectos nuevos de ese commit), así que
  // esta llamada gana sobre el `previouslyFocused?.focus()` inútil del Modal.
  useEffect(() => {
    if (!newProjectOpen) {
      newProjectRestoreFocusRef.current?.focus();
    }
  }, [newProjectOpen]);

  /** Crea el proyecto nuevo (mismo server action que `moveToNew` usaba con `window.prompt`) y
   * mueve la transcripción actual ahí apenas se crea. */
  async function submitNewProject() {
    if (newProjectPending) return; // evita duplicados si el usuario aprieta Enter dos veces rápido
    if (!newProjectName.trim()) return;
    setNewProjectPending(true);
    const fd = new FormData();
    fd.set("name", newProjectName);
    fd.set("icon", "📁");
    const res = await createProject(fd);
    if (res.ok) {
      await assignTranscriptionToProject(transcription.id, res.id);
      setNewProjectPending(false);
      closeNewProjectModal();
      toast("Proyecto creado y transcripción movida.", "success");
      router.refresh();
    } else {
      setNewProjectPending(false);
      setNewProjectError(res.error ?? "No se pudo crear el proyecto.");
    }
  }

  async function remove() {
    if (!confirm("¿Borrar esta transcripción? También se borra su audio. No se puede deshacer.")) return;
    setHidden(true); // feedback inmediato
    const res = await deleteTranscription(transcription.id);
    if (res.ok) {
      toast("Transcripción borrada.", "success");
      router.refresh();
    } else {
      setHidden(false); // si falla, la volvemos a mostrar
      toast(res.error ?? "No se pudo borrar.", "error");
    }
  }

  if (hidden) return null;

  return (
    <li
      draggable={!busy}
      onDragStart={handleDragStart}
      onDragEnd={() => setDragging(false)}
      className={`flex cursor-grab items-stretch gap-1 rounded-xl border border-border bg-surface transition hover:border-accent hover:shadow-sm active:cursor-grabbing ${
        busy ? "opacity-50" : ""
      } ${dragging ? "opacity-40" : ""}`}
    >
      <Link href={`/app/t/${transcription.id}`} draggable={false} className="block min-w-0 flex-1 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="truncate font-semibold text-foreground">
            <span className="mr-1.5">{transcription.icon || "📄"}</span>
            {displayName}
          </p>
          <span className="shrink-0 text-xs text-tertiary">{formatDate(transcription.created_at)}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-secondary">
          {transcription.text || "(sin texto)"}
        </p>
      </Link>
      <div ref={menuContainerRef} className="flex items-start p-2">
        <IconMenu label="Opciones de la transcripción">
          {(close) => (
            <>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-tertiary">
                Mover a
              </p>
              <div className="max-h-56 overflow-auto">
                <MenuItem onClick={() => { moveTo(null, "Sin proyecto"); close(); }}>
                  {transcription.project_id === null ? "✓ " : ""}📄 Sin proyecto
                </MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.id} onClick={() => { moveTo(p.id, p.name); close(); }}>
                    {transcription.project_id === p.id ? "✓ " : ""}
                    {p.icon || "📁"} {p.name}
                  </MenuItem>
                ))}
                <MenuItem
                  onClick={() => {
                    // Capturado ANTES de `close()`: en este punto el botón "..." todavía está
                    // montado (`close()` recién lo desmonta al re-renderizar el popover).
                    newProjectRestoreFocusRef.current =
                      menuContainerRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? null;
                    setNewProjectOpen(true);
                    close();
                  }}
                >
                  ＋ Proyecto nuevo…
                </MenuItem>
              </div>
              <div className="my-1 border-t border-border" />
              <MenuItem danger onClick={() => { remove(); close(); }}>🗑️ Borrar</MenuItem>
            </>
          )}
        </IconMenu>
      </div>
      {newProjectOpen && (
        <Modal onClose={closeNewProjectModal} labelledBy="new-project-title">
          <h2 id="new-project-title" className="text-lg font-semibold text-foreground">
            Proyecto nuevo
          </h2>
          <p className="mt-1 text-sm text-secondary">Se crea el proyecto y esta transcripción se mueve ahí.</p>
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            autoFocus
            placeholder="Nombre del proyecto"
            aria-label="Nombre del proyecto"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewProject();
            }}
            className="mt-4 w-full rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
          />
          {newProjectError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{newProjectError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={closeNewProjectModal}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submitNewProject} loading={newProjectPending}>
              Crear
            </Button>
          </div>
        </Modal>
      )}
    </li>
  );
}
