"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportClamp } from "@/hooks/useViewportClamp";
import { PROJECT_COLORS, getProjectColor, type ProjectColorId } from "@/lib/project-colors";

const PICKER_WIDTH = 176; // 4 columnas de swatches de 7 (grid-cols-4), igual criterio que EmojiPicker

/**
 * Selector de color de proyecto (Fase F2, estilo VS Code "Peacock"): la paleta curada de
 * `src/lib/project-colors.ts` (12 colores) + "Sin color" (neutro). Mismo patrón de popover que
 * `EmojiPicker` (portal a `document.body` + `useViewportClamp` + cierre por click afuera/Escape)
 * para mantener la misma familiaridad de uso — se usa siempre al lado de un `EmojiPicker` en los
 * formularios de crear/editar proyecto.
 */
export function ProjectColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { coords, triggerRef, panelRef } = useViewportClamp(open, PICKER_WIDTH, { align: "left" });
  const current = getProjectColor(value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
    // Los refs son estables entre renders — no hace falta re-suscribir salvo que cambie `open`
    // (mismo criterio que EmojiPicker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(id: ProjectColorId | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={current ? `Color: ${current.label}. Cambiar color` : "Elegir color de proyecto"}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current ? current.label : "Sin color"}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong transition hover:border-accent"
      >
        {current ? (
          <span className={`h-4 w-4 rounded-full ${current.dot}`} aria-hidden="true" />
        ) : (
          <span className="h-4 w-4 rounded-full border-2 border-dashed border-border-strong" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Elegir color de proyecto"
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: PICKER_WIDTH,
              visibility: coords ? "visible" : "hidden",
            }}
            // z-50: mismo motivo que EmojiPicker/IconMenu — puede abrirse desde dentro del drawer
            // mobile (z-40) y necesita quedar por encima.
            className="z-50 grid grid-cols-4 gap-1.5 rounded-xl border border-border bg-surface p-2.5 shadow-lg"
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!value}
              aria-label="Sin color"
              title="Sin color"
              onClick={() => pick(null)}
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed transition hover:border-accent ${
                !value ? "border-accent ring-2 ring-accent ring-offset-2 ring-offset-surface" : "border-border-strong"
              }`}
            >
              <span className="sr-only">Sin color</span>
            </button>
            {PROJECT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={value === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => pick(c.id)}
                className="flex h-7 w-7 items-center justify-center rounded-full"
              >
                <span
                  className={`h-full w-full rounded-full ${c.dot} ${
                    value === c.id ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
