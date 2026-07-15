"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import type { AiRecipe } from "@/lib/recipes/types";
import { MAX_NAME_LENGTH, MAX_INSTRUCTION_LENGTH, MAX_RECIPES, canAddRecipe } from "@/lib/recipes/validate";

/**
 * Sección "Formatos" de Ajustes (ver brief "Formatos" 2026-07-13): instrucciones reutilizables que
 * el usuario guarda una vez ("Convertí esto en un brief de producción...", "Armá 3 hooks para un
 * reel") y aplica con un click a cualquier transcripción desde el detalle, en vez de re-escribirlas
 * en el chat cada vez.
 *
 * Mismo criterio que `VocabularySection`: `useState` local sembrado con `initialRecipes` (resuelto
 * server-side, sin flicker), mutaciones optimistas contra `/api/recipes` con revert-on-failure. A
 * diferencia del vocabulario (chips de una sola línea), un formato tiene DOS campos (nombre +
 * instrucción, potencialmente un párrafo largo) y un tercer estado que el vocabulario no tiene: cuál
 * es el "formato por defecto" — se muestra como tarjetas, no chips, con un formulario de edición
 * inline en vez de un `<input>` suelto.
 *
 * Copy: sin jerga técnica visible (nunca "prompt"/"IA"/"modelo"/"LLM") — "Formato", "¿Qué querés que
 * haga con la nota?", "Usar por defecto".
 */
export function FormatosSection({ initialRecipes }: { initialRecipes: AiRecipe[] }) {
  const { show: toast } = useToast();
  const [recipes, setRecipes] = useState(initialRecipes);
  const [nameDraft, setNameDraft] = useState("");
  const [instructionDraft, setInstructionDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInstruction, setEditInstruction] = useState("");

  const atLimit = !canAddRecipe(recipes.length);

  async function addRecipe() {
    const name = nameDraft.trim();
    const instruction = instructionDraft.trim();
    if (!name || !instruction || atLimit || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo guardar el formato.", "error");
        return;
      }
      setRecipes((prev) => [...prev, data.recipe as AiRecipe]);
      setNameDraft("");
      setInstructionDraft("");
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(recipe: AiRecipe) {
    setEditingId(recipe.id);
    setEditName(recipe.name);
    setEditInstruction(recipe.instruction);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function commitEdit(recipe: AiRecipe) {
    const name = editName.trim();
    const instruction = editInstruction.trim();
    if (!name || !instruction) return;
    setBusyId(recipe.id);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo editar el formato.", "error");
        return;
      }
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? (data.recipe as AiRecipe) : r)));
      setEditingId(null);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRecipe(recipe: AiRecipe) {
    setBusyId(recipe.id);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? "No se pudo borrar el formato.", "error");
        return;
      }
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  /** Marca `recipe` como el formato por defecto — optimista: desmarca cualquier otro en el estado
   * local YA (solo puede haber uno), revierte todo si el server rechaza el cambio. */
  async function toggleDefault(recipe: AiRecipe) {
    if (recipe.isDefault) return; // ya es el default, no hay toggle para "sacarlo" (mismo criterio que la DB: siempre hay que elegir otro)
    const previous = recipes;
    setRecipes((prev) => prev.map((r) => ({ ...r, isDefault: r.id === recipe.id })));
    setBusyId(recipe.id);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRecipes(previous);
        toast(data.error ?? "No se pudo marcar el formato por defecto.", "error");
        return;
      }
    } catch {
      setRecipes(previous);
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background" aria-hidden="true">
          <Icon name="sparkles" size={18} />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Formatos</h2>
          <p className="text-sm text-tertiary">
            Guardá instrucciones que usás seguido (un brief, hooks para un reel, una escaleta) y
            aplicalas con un click desde cualquier nota.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-border-strong p-3">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Nombre del formato — ej: Brief de producción"
          aria-label="Nombre del nuevo formato"
          disabled={atLimit || adding}
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent disabled:opacity-60"
        />
        <textarea
          value={instructionDraft}
          onChange={(e) => setInstructionDraft(e.target.value)}
          maxLength={MAX_INSTRUCTION_LENGTH}
          rows={2}
          placeholder="¿Qué querés que haga con la nota? — ej: Convertí esto en un brief de producción con objetivo, público, tono y entregables."
          aria-label="Instrucción del nuevo formato"
          disabled={atLimit || adding}
          className="w-full resize-y rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent disabled:opacity-60"
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            loading={adding}
            disabled={atLimit || !nameDraft.trim() || !instructionDraft.trim()}
            onClick={addRecipe}
          >
            Nuevo formato
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="mt-1.5 text-xs text-tertiary">
        {atLimit ? `Llegaste al máximo de ${MAX_RECIPES} formatos.` : ""}
      </p>

      {recipes.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {recipes.map((recipe) => (
            <li key={recipe.id} className="rounded-lg border border-border-strong bg-background p-3">
              {editingId === recipe.id ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={MAX_NAME_LENGTH}
                    aria-label={`Editar nombre de "${recipe.name}"`}
                    className="w-full rounded-lg border border-accent bg-transparent px-3 py-2 text-sm text-foreground outline-none"
                  />
                  <textarea
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    maxLength={MAX_INSTRUCTION_LENGTH}
                    rows={2}
                    aria-label={`Editar instrucción de "${recipe.name}"`}
                    className="w-full resize-y rounded-lg border border-accent bg-transparent px-3 py-2 text-sm text-foreground outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={busyId === recipe.id}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      loading={busyId === recipe.id}
                      disabled={!editName.trim() || !editInstruction.trim()}
                      onClick={() => commitEdit(recipe)}
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {recipe.isDefault && <Icon name="star" className="shrink-0 fill-current" />}
                      {recipe.name}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-tertiary">{recipe.instruction}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleDefault(recipe)}
                      disabled={busyId === recipe.id || recipe.isDefault}
                      aria-pressed={recipe.isDefault}
                      title={recipe.isDefault ? "Ya es tu formato por defecto" : "Usar como formato por defecto"}
                      className="rounded-md p-1.5 text-tertiary transition hover:text-accent disabled:cursor-default disabled:opacity-100"
                    >
                      <Icon name="star" className={recipe.isDefault ? "fill-current" : undefined} />
                      <span className="sr-only">
                        {recipe.isDefault ? "Formato por defecto" : `Usar "${recipe.name}" como formato por defecto`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(recipe)}
                      disabled={busyId === recipe.id}
                      aria-label={`Editar "${recipe.name}"`}
                      className="rounded-md p-1.5 text-tertiary transition hover:text-accent disabled:opacity-50"
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecipe(recipe)}
                      disabled={busyId === recipe.id}
                      aria-label={`Borrar "${recipe.name}"`}
                      className="rounded-md p-1.5 text-tertiary transition hover:text-red-500 disabled:opacity-50"
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">Todavía no creaste ningún formato.</p>
      )}
    </div>
  );
}
