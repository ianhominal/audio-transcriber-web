"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { assignTranscriptionToProject } from "./actions";
import {
  TRANSCRIPTION_DRAG_MIME,
  decodeTranscriptionDragPayload,
  resolveTranscriptionDrop,
} from "@/lib/dnd/transcriptionDrag";

/**
 * El link "Sin proyecto" del sidebar, con soporte de drop (mecanismo 1 de mover transcripciones
 * entre proyectos): soltar una fila acá desasigna su proyecto (`project_id = null`), reusando la
 * misma server action que el menú "..." de cada fila (mecanismo 2, `transcription-row.tsx`).
 *
 * Vive en un componente cliente aparte (en vez de ser parte de `SidebarLink` en `page.tsx`,
 * Server Component) porque necesita `onDragOver`/`onDrop`.
 */
export function UnassignedProjectLink({ active, count }: { active: boolean; count: number }) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [dragOver, setDragOver] = useState(false);

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
    const resolution = resolveTranscriptionDrop(payload, null, []);
    if (!resolution.shouldMove) return;
    const res = await assignTranscriptionToProject(resolution.id, resolution.projectId);
    toast(res.ok ? "Movido a Sin proyecto." : "No se pudo mover la transcripción.", res.ok ? "success" : "error");
    router.refresh();
  }

  return (
    <Link
      href="/app?project=none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
        active ? "bg-accent-subtle font-semibold text-accent-subtle-text" : "text-secondary hover:bg-surface-secondary"
      } ${dragOver ? "bg-accent-subtle ring-2 ring-inset ring-accent" : ""}`}
    >
      <span className="text-base leading-none">📄</span>
      <span className="min-w-0 flex-1 truncate">Sin proyecto</span>
      <span className="shrink-0 text-xs tabular-nums text-tertiary">{count}</span>
    </Link>
  );
}
