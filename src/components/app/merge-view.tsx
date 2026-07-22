"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { MAX_MERGE_INSTRUCTION_LENGTH } from "@/lib/merge/validate";
import { useMergeStream } from "@/lib/merge/useMergeStream";
import { MergeResult } from "@/components/app/merge-result";

type MergeNote = { id: string; title: string; createdAt: string };

/**
 * "Merge several notes into one document" (feature 2026-07-13, see brief) — per-project view (not
 * multi-select, see header comment in `src/lib/merge/validate.ts`). The streaming + "save as note"
 * logic lives in `useMergeStream` (`src/lib/merge/useMergeStream.ts`), extracted 2026-07-22 (fase 2)
 * so the "Combinar en documento" action embedded in the assistant (`ChatPanel`) can reuse it without
 * duplicating the manual `res.body.getReader()` + header-reading pattern. The result region (document
 * + copy/save actions + truncation notice) lives in `MergeResult`
 * (`src/components/app/merge-result.tsx`), same reuse reason. This component keeps ONLY what's
 * specific to the per-project page: the note list card and the instruction textarea/button.
 */
export function MergeView({
  projectId,
  projectName,
  notes,
  totalNotesInProject,
}: {
  projectId: string;
  projectName: string;
  notes: MergeNote[];
  /** Total DIRECT notes in the project (not just the ones offered here, already capped at
   * MAX_MERGE_NOTES by the server page). When this is greater than `notes.length`, the project has
   * more notes than the merge cap allows — used to warn the user BEFORE merging that some of their
   * newer notes were left out, since the notes list itself only ever contains the oldest ones. */
  totalNotesInProject: number;
}) {
  const { show: toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const merge = useMergeStream(toast);

  const notesLeftOut = totalNotesInProject - notes.length;

  return (
    <div className="mt-3" data-project-id={projectId}>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Unir en un documento</h1>

      <div className="mt-4 rounded-xl border border-border-strong bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">
          Vamos a unir estas {notes.length} notas de {projectName}:
        </p>
        {notesLeftOut > 0 && (
          <p className="mt-1 text-xs text-tertiary">
            Este proyecto tiene {totalNotesInProject} notas; vamos a unir las {notes.length} más antiguas.
          </p>
        )}
        <ul className="mt-2 space-y-1.5">
          {notes.map((note) => (
            <li key={note.id} className="flex items-baseline justify-between gap-2 text-sm text-secondary">
              <span className="min-w-0 truncate">{note.title}</span>
              <span className="shrink-0 text-xs text-tertiary">{formatDate(note.createdAt)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-xl border border-border-strong bg-surface p-4">
        <label htmlFor="merge-instruction" className="text-sm font-semibold text-foreground">
          ¿Cómo querés unirlas?
        </label>
        <textarea
          id="merge-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          maxLength={MAX_MERGE_INSTRUCTION_LENGTH}
          placeholder="Ej.: armá un brief de producción / armá un outline de guion / dejalo como un artículo corrido"
          aria-label="¿Cómo querés unirlas?"
          className="mt-2 w-full resize-y rounded-lg border border-border-strong p-3 text-sm text-secondary focus:border-accent focus:outline-none"
        />
        <div className="mt-3">
          <Button
            variant="primary"
            loading={merge.merging}
            disabled={merge.merging}
            onClick={() => merge.mergeNotes(notes.map((n) => n.id), instruction)}
          >
            {merge.merging ? "Generando…" : "Unir en un documento"}
          </Button>
        </div>

        <MergeResult
          merging={merge.merging}
          output={merge.output}
          done={merge.done}
          truncated={merge.truncated}
          includedCount={merge.includedCount}
          totalConsideredNotes={notes.length}
          savingNote={merge.savingNote}
          noteSavedId={merge.noteSavedId}
          onSave={merge.saveAsNote}
        />
      </div>
    </div>
  );
}
