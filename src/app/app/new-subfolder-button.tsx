"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSubproject } from "./actions";
import { EmojiPicker } from "./emoji-picker";
import { ProjectColorPicker } from "./project-color-picker";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/**
 * Botón "Nueva carpeta" del explorador jerárquico: abre un modal (nombre + ícono + contexto
 * opcional) y crea una subcarpeta DENTRO del proyecto/carpeta actual (`parentId`).
 *
 * `available = false` cuando la migración de jerarquía todavía no está aplicada en producción
 * (ver `schema-compat.ts`): el botón queda deshabilitado con un tooltip explicando por qué, en
 * vez de dejar que el usuario intente y se choque con un error recién al enviar el formulario.
 */
export function NewSubfolderButton({
  parentId,
  available = true,
}: {
  parentId: string;
  available?: boolean;
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📁");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setIcon("📁");
    setColor(null);
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    setPending(true);
    const res = await createSubproject(parentId, name, description, icon, color);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    close();
    toast("Subcarpeta creada.", "success");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!available}
        title={available ? undefined : "Las subcarpetas todavía no están disponibles para tu cuenta."}
      >
        📁 Nueva carpeta
      </Button>
      {open && (
        <Modal onClose={close} labelledBy="new-subfolder-title">
          <h2 id="new-subfolder-title" className="text-lg font-semibold text-foreground">
            Nueva carpeta
          </h2>
          <div className="mt-4 flex gap-2">
            <EmojiPicker value={icon} onChange={setIcon} />
            <ProjectColorPicker value={color} onChange={setColor} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Nombre de la carpeta"
              aria-label="Nombre de la carpeta"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="min-w-0 flex-1 rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
            />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Contexto o descripción (opcional)…"
            aria-label="Contexto o descripción de la carpeta"
            className="mt-3 w-full resize-y rounded-lg border border-border-strong p-2.5 text-sm text-secondary focus:border-accent focus:outline-none"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={close}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submit} loading={pending}>
              Crear
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
