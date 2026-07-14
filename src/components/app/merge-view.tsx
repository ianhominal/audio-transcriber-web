"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { MAX_MERGE_INSTRUCTION_LENGTH } from "@/lib/merge/validate";

type MergeNote = { id: string; title: string; createdAt: string };

/**
 * "Merge several notes into one document" (feature 2026-07-13, see brief) — per-project view (not
 * multi-select, see header comment in `src/lib/merge/validate.ts`). EXACTLY replicates the manual
 * streaming + actions pattern already used by "Apply format" in
 * `src/app/app/t/[id]/transcription-detail.tsx` (`applyRecipe`/`saveApplyOutputAsNote`): fetch with
 * `res.body.getReader()` + `TextDecoder`, without inventing a new pattern. The
 * `X-Merge-Truncated`/`X-Merge-Included-Count` headers (see `/api/notes/merge`) are read off the
 * `Response` BEFORE consuming the body — the plain-text stream carries no embedded marker.
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
  const router = useRouter();
  const { show: toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [merging, setMerging] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [includedCount, setIncludedCount] = useState<number | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSavedId, setNoteSavedId] = useState<string | null>(null);

  const notesLeftOut = totalNotesInProject - notes.length;

  async function mergeNotes() {
    if (merging) return;
    setMerging(true);
    setOutput("");
    setDone(false);
    setTruncated(false);
    setIncludedCount(null);
    setNoteSavedId(null);
    try {
      const res = await fetch("/api/notes/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptionIds: notes.map((n) => n.id), instruction }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast(data.error ?? "Llegaste al límite diario de uniones. Probá de nuevo mañana.", "error");
        } else if (res.status === 404) {
          toast(data.error ?? "No pudimos encontrar alguna de las notas elegidas.", "error");
        } else {
          toast(data.error ?? "No se pudo unir las notas.", "error");
        }
        return;
      }

      // Read BEFORE consuming the body — same reason documented in the route: the plain-text stream
      // carries no embedded marker to transmit this metadata.
      setTruncated(res.headers.get("X-Merge-Truncated") === "true");
      const includedHeader = res.headers.get("X-Merge-Included-Count");
      setIncludedCount(includedHeader ? Number(includedHeader) : null);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        acc += decoder.decode(value, { stream: true });
        setOutput(acc);
      }
      setDone(true);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setMerging(false);
    }
  }

  /** "Save as note" for the merged document — same endpoint/shape used by the rest of the app
   * (`POST /api/notes`, see `saveApplyOutputAsNote` in `transcription-detail.tsx`). */
  async function saveAsNote() {
    if (!output.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: output }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo guardar la nota.", "error");
        return;
      }
      setNoteSavedId(data.id);
      toast("Guardado ✓", "success");
      router.push(`/app/t/${data.id}`);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setSavingNote(false);
    }
  }

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
          <Button variant="primary" loading={merging} disabled={merging} onClick={mergeNotes}>
            {merging ? "Generando…" : "Unir en un documento"}
          </Button>
        </div>

        {/* Live region: same criteria as "Resumen con IA"/"Aplicar formato" in
            `transcription-detail.tsx` — announces when generation starts and when the result
            appears, without the user having to go look for it. */}
        <div role="status" aria-live="polite">
          {merging && !output && <p className="mt-3 text-xs text-tertiary">Generando…</p>}
          {output && (
            <div className="mt-4 space-y-3">
              {done && truncated && includedCount !== null && (
                <p className="text-xs text-tertiary">
                  Nota: el texto combinado era muy largo, así que unimos las primeras {includedCount} de{" "}
                  {notes.length} notas.
                </p>
              )}
              <MarkdownContent text={output} className="text-sm text-secondary" />
              {done && (
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton text={output} label="Copiar" ariaLabel="Copiar documento unido" />
                  {noteSavedId ? (
                    <Link href={`/app/t/${noteSavedId}`} className="text-xs font-semibold text-accent hover:underline">
                      Guardado ✓ · Ver nota
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={saveAsNote}
                      disabled={savingNote}
                      className="text-xs font-medium text-tertiary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingNote ? "Guardando…" : "Guardar como nota"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
