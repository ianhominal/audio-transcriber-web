"use client";

import { useRef, useState } from "react";
import { createProject } from "./actions";

/** Botón + formulario inline para crear un proyecto. */
export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handle(formData: FormData) {
    setPending(true);
    const res = await createProject(formData);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "No se pudo crear.");
      return;
    }
    setError(null);
    setOpen(false);
    formRef.current?.reset();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
      >
        + Nuevo proyecto
      </button>
    );
  }

  return (
    <form ref={formRef} action={handle} className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex gap-2">
        <input
          name="icon"
          maxLength={2}
          placeholder="📁"
          className="w-10 shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-center"
          aria-label="Ícono del proyecto"
        />
        <input
          name="name"
          autoFocus
          placeholder="Nombre del proyecto"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          aria-label="Nombre del proyecto"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Creando…" : "Crear"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
