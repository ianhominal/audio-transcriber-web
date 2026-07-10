"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import type { VocabularyTerm } from "@/lib/vocabulary/types";
import { MAX_TERM_LENGTH, MAX_VOCABULARY_TERMS, canAddVocabularyTerm } from "@/lib/vocabulary/validate";

/**
 * Sección "Vocabulario" de Ajustes — feature diferencial #1 (ver .claude/resources/BUSINESS.md):
 * nombres de invitados recurrentes, marcas o jerga que la app corrige sola la próxima vez que el
 * usuario transcribe (ver `/api/transcribe`, paso 2.6, y `src/lib/vocabulary/groq.ts`).
 *
 * A diferencia de `TranscriptionDefaultsSection` (que usa `useTranscriptionDefaults` + cache en
 * `localStorage`), acá NO hace falta ese hook compartido: el vocabulario solo se lee/edita desde
 * esta pantalla (la corrección en `/api/transcribe` lee directo de Supabase, server-side, nunca del
 * cliente) — un `useState` local sembrado con `initialTerms` (resuelto server-side, sin flicker) es
 * suficiente y evita una capa de indirección sin un segundo consumidor que la justifique.
 *
 * Agregar/editar/borrar son mutaciones optimistas simples contra `/api/vocabulary`: cada operación
 * actualiza el estado local recién cuando el server confirma (no antes), con un toast de error si
 * falla — mismo criterio de feedback que el resto de Ajustes.
 */
export function VocabularySection({ initialTerms }: { initialTerms: VocabularyTerm[] }) {
  const { show: toast } = useToast();
  const [terms, setTerms] = useState(initialTerms);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  // Id del término con una mutación (editar/borrar) en vuelo — deshabilita SOLO ese chip, no toda
  // la lista, mismo criterio de "estado por ítem, no global" que `TranscriptionDefaultsSection`.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Guardia de reentrancia para el chip en edición: al confirmar con Enter se limpia `editingId`, lo
  // que desmonta el <input> y dispara su `onBlur` — que también llama a `commitEdit`. Sin esta
  // guardia se mandarían DOS requests PATCH (uno por Enter, otro por el blur). Se resetea en cada
  // `startEdit`; `cancelEdit` la activa para que el blur posterior a un Escape no guarde nada.
  const commitGuardRef = useRef(false);

  const atLimit = !canAddVocabularyTerm(terms.length);

  async function addTerm() {
    const value = draft.trim();
    if (!value || atLimit || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo agregar el término.", "error");
        return;
      }
      setTerms((prev) => [...prev, data.term as VocabularyTerm]);
      setDraft("");
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(term: VocabularyTerm) {
    commitGuardRef.current = false;
    setEditingId(term.id);
    setEditDraft(term.term);
  }

  function cancelEdit() {
    commitGuardRef.current = true; // el blur que dispara el desmontaje NO debe guardar
    setEditingId(null);
  }

  async function commitEdit(term: VocabularyTerm) {
    if (commitGuardRef.current) return; // ya se confirmó/canceló esta edición (evita el PATCH doble)
    commitGuardRef.current = true;
    const value = editDraft.trim();
    setEditingId(null);
    if (!value || value === term.term) return; // sin cambio real, no gasta un request
    setBusyId(term.id);
    try {
      const res = await fetch(`/api/vocabulary/${term.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo editar el término.", "error");
        return;
      }
      setTerms((prev) => prev.map((t) => (t.id === term.id ? (data.term as VocabularyTerm) : t)));
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeTerm(term: VocabularyTerm) {
    setBusyId(term.id);
    try {
      const res = await fetch(`/api/vocabulary/${term.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? "No se pudo borrar el término.", "error");
        return;
      }
      setTerms((prev) => prev.filter((t) => t.id !== term.id));
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-lg" aria-hidden="true">
          📖
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Vocabulario</h2>
          <p className="text-sm text-tertiary">
            Palabras o nombres que querés que la app escriba siempre bien: invitados, marcas, jerga.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTerm();
            }
          }}
          maxLength={MAX_TERM_LENGTH}
          placeholder="Ej: Valentino, Fulanito FM…"
          aria-label="Nuevo término del vocabulario"
          disabled={atLimit || adding}
          className="min-w-0 flex-1 rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent disabled:opacity-60"
        />
        <Button variant="secondary" size="sm" loading={adding} disabled={atLimit || !draft.trim()} onClick={addTerm}>
          Agregar
        </Button>
      </div>

      <p role="status" aria-live="polite" className="mt-1.5 text-xs text-tertiary">
        {atLimit ? `Llegaste al máximo de ${MAX_VOCABULARY_TERMS} términos.` : ""}
      </p>

      {terms.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {terms.map((term) => (
            <li
              key={term.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-sm text-secondary"
            >
              {editingId === term.id ? (
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitEdit(term)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit(term);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  maxLength={MAX_TERM_LENGTH}
                  aria-label={`Editar "${term.term}"`}
                  className="w-40 min-w-0 max-w-full rounded border border-accent bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(term)}
                  disabled={busyId === term.id}
                  aria-label={`Editar "${term.term}"`}
                  className="max-w-[10rem] truncate disabled:opacity-50"
                >
                  {term.term}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeTerm(term)}
                disabled={busyId === term.id || editingId === term.id}
                aria-label={`Quitar "${term.term}" del vocabulario`}
                className="shrink-0 text-tertiary transition hover:text-red-500 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          Todavía no agregaste ningún término. Se corrigen solos la próxima vez que transcribas.
        </p>
      )}
    </div>
  );
}
