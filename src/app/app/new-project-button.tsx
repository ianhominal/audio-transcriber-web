"use client";

import { useRef, useState } from "react";
import { createProject } from "./actions";
import { EmojiPicker } from "./emoji-picker";
import { ProjectColorPicker } from "./project-color-picker";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/** Botón + formulario inline para crear un proyecto. */
export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState("📁");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { show: toast } = useToast();

  async function handle(formData: FormData) {
    formData.set("icon", icon);
    if (color) formData.set("color", color);
    setPending(true);
    const res = await createProject(formData);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "No se pudo crear.");
      return;
    }
    setError(null);
    setOpen(false);
    setIcon("📁");
    setColor(null);
    formRef.current?.reset();
    toast("Proyecto creado.", "success");
  }

  const descriptionId = "new-project-description";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm font-medium text-tertiary transition hover:border-accent hover:text-accent"
      >
        + Nuevo proyecto
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={handle}
      className="space-y-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm"
    >
      <div className="flex gap-2">
        <EmojiPicker value={icon} onChange={setIcon} />
        <ProjectColorPicker value={color} onChange={setColor} />
        <input
          name="name"
          autoFocus
          placeholder="Nombre del proyecto"
          className="min-w-0 flex-1 rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
          aria-label="Nombre del proyecto"
        />
      </div>
      <textarea
        name="description"
        id={descriptionId}
        rows={2}
        placeholder="Contexto o descripción (opcional)…"
        aria-label="Contexto o descripción del proyecto"
        className="w-full resize-y rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending} className="flex-1">
          {pending ? "Creando…" : "Crear"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
