"use client";

import Link from "next/link";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";

/**
 * Región "resultado" de "Combinar en documento" (estado en vivo + documento + acciones) — extraída
 * de `merge-view.tsx` (feature 2026-07-13) para reusarla TAL CUAL desde la acción "Combinar en
 * documento" embebida en el asistente scopeado a proyecto (`ChatPanel`, feature 2026-07-22 fase 2).
 * Puramente presentacional: todo el estado vive en `useMergeStream` (`src/lib/merge/useMergeStream.ts`),
 * este componente solo lo renderiza — mismo criterio de separación que el resto de la UI de esta app
 * (`src/lib` = lógica, `src/components` = presentación).
 *
 * `role="status"`: mismo criterio que "Resumen con IA"/"Aplicar formato" en `transcription-detail.tsx`
 * — anuncia cuando arranca la generación y cuando aparece el resultado, sin que la usuaria tenga que
 * ir a buscarlo.
 */
export function MergeResult({
  merging,
  output,
  done,
  truncated,
  includedCount,
  totalConsideredNotes,
  savingNote,
  noteSavedId,
  onSave,
}: {
  merging: boolean;
  output: string;
  done: boolean;
  truncated: boolean;
  includedCount: number | null;
  /** Cantidad de notas consideradas para el merge (para el aviso de truncado: "las primeras N de
   * TOTAL notas"). */
  totalConsideredNotes: number;
  savingNote: boolean;
  noteSavedId: string | null;
  onSave: () => void;
}) {
  return (
    <div role="status" aria-live="polite">
      {merging && !output && <p className="mt-3 text-xs text-tertiary">Generando…</p>}
      {output && (
        <div className="mt-4 space-y-3">
          {done && truncated && includedCount !== null && (
            <p className="text-xs text-tertiary">
              Nota: el texto combinado era muy largo, así que unimos las primeras {includedCount} de{" "}
              {totalConsideredNotes} notas.
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
                  onClick={onSave}
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
  );
}
