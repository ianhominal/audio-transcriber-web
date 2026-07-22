"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/app/chat-panel";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";

/**
 * Entry point to "Chat con IA" scoped to ONE project ("Este proyecto" — see `ChatPanel`,
 * `src/lib/chat/scope.ts`) from the project/folder view (`page.tsx`). Same `useState` open/close
 * idiom as `NewSubfolderButton`, but renders `ChatPanel` INLINE below the actions row instead of
 * inside a `Modal`: `ChatPanel` is always mounted inline everywhere else in the app (per-note page,
 * `/app/brain`), never inside a `Modal` — its message log/input already manage their own height and
 * scrolling, and `Modal` caps width at `max-w-md`, too narrow for a comfortable chat. `w-full` on
 * the wrapper forces it onto its own line within the parent's `flex flex-wrap` actions row, instead
 * of squeezing next to the buttons.
 *
 * `mergeCandidates` (feature 2026-07-22 fase 2): "Unir notas" dejó de ser un botón aparte y pasó a
 * ser la acción "Combinar en documento" DENTRO del asistente (ver `ChatPanel`) — este componente solo
 * threadea el dato (resuelto server-side en `page.tsx` vía `fetchMergeCandidates`), no tiene lógica
 * propia sobre merge.
 */
export function ProjectChatButton({
  projectId,
  projectName,
  mergeCandidates,
}: {
  projectId: string;
  projectName: string;
  mergeCandidates?: { notes: { id: string; title: string; createdAt: string }[]; totalNotesInProject: number };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="chat" /> {open ? "Ocultar chat" : "Preguntar a la IA"}
      </Button>
      {open && (
        <div className="w-full">
          <ChatPanel
            defaultScope="project"
            projectId={projectId}
            projectName={projectName}
            mergeCandidates={mergeCandidates}
          />
        </div>
      )}
    </>
  );
}
