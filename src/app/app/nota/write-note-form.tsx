"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";

/**
 * "Escribir nota": crear una nota TECLEÁNDOLA, sin grabar nada. Guarda contra `/api/notes` con
 * `source: "manual"` (mismo endpoint que "Guardar como nota" del chat — la nota es una fila
 * text-only en `transcriptions`, ver `src/lib/notes/writtenNote.ts`), así que queda en la MISMA
 * lista y el mismo proyecto que las transcripciones y sirve igual para chat/resumen/formatos.
 *
 * El título es opcional: si no se escribe, el server lo deriva de la primera línea.
 */
export function WriteNoteForm({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const backHref = projectId ? `/app?project=${projectId}` : "/app";

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const resp = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "manual", text, title, projectId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "No se pudo guardar la nota.");
        setSaving(false);
        return;
      }
      router.refresh();
      // Igual que al terminar de grabar: la llevamos derecho a su nota nueva, no a un link.
      router.replace(`/app/t/${data.id}`);
    } catch {
      setError("No se pudo guardar la nota. Revisá tu conexión y probá de nuevo.");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link
          href={backHref}
          className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
        >
          ← Volver
        </Link>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-foreground">Escribir nota</h1>
      <p className="mt-1 text-sm text-secondary">
        {projectName ? (
          <>
            Se va a guardar en <span className="font-medium text-foreground">{projectName}</span>, junto a tus
            transcripciones.
          </>
        ) : (
          "Queda en la misma lista que tus transcripciones, y podés usar el chat y los formatos igual."
        )}
      </p>

      <div className="mt-5 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <label htmlFor="note-title" className="block text-sm font-medium text-secondary">
          Título <span className="font-normal text-tertiary">(opcional)</span>
        </label>
        <input
          id="note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Si lo dejás vacío, usamos la primera línea"
          className="mt-1.5 w-full rounded-lg border border-border-strong px-3 py-2 text-foreground focus:border-accent focus:outline-none"
        />

        <label htmlFor="note-text" className="mt-4 block text-sm font-medium text-secondary">
          Nota
        </label>
        <textarea
          id="note-text"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Escribí lo que se te ocurra…"
          className="mt-1.5 w-full resize-y rounded-lg border border-border-strong p-3 text-foreground focus:border-accent focus:outline-none"
        />

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
            <Icon name="warning" className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!text.trim()} loading={saving} size="lg">
            {saving ? "Guardando…" : "Guardar nota"}
          </Button>
          <Link
            href={backHref}
            className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
          >
            Cancelar
          </Link>
        </div>
      </div>
    </div>
  );
}
