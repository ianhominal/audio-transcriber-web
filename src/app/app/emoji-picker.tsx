"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportClamp } from "@/hooks/useViewportClamp";

// Set curado de emojis útiles para proyectos (cero dependencias, offline).
const EMOJIS = [
  "📁", "📂", "🗂️", "📝", "📄", "📌",
  "💼", "🎓", "🎧", "🎙️", "🎵", "💡",
  "🚀", "⭐", "❤️", "🔥", "✅", "🎯",
  "🗓️", "💬", "📞", "🛒", "✈️", "🏠",
  "🏢", "💻", "📱", "🧠", "⚙️", "🔒",
  "🌍", "🎨", "📊", "💰", "🐾", "🍔",
];

const PICKER_WIDTH = 224; // w-56

export function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Portal a `document.body` + clampeo al viewport (mismo patrón que `IconMenu`, extraído a
  // `useViewportClamp`) — antes era `absolute left-0 w-56` sin clamp, así que en pantallas
  // angostas (~360-390px) se salía por el borde derecho. `align: "left"` preserva el crecimiento
  // hacia la derecha que ya tenía (el trigger suele ser el primer elemento de una fila).
  const { coords, triggerRef, panelRef } = useViewportClamp(open, PICKER_WIDTH, { align: "left" });

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Escape en fase de CAPTURA (no bubble): si este picker se abre DENTRO de un `Modal`
    // (`components/ui/Modal.tsx`), su propio listener de Escape vive en `document` en fase bubble.
    // Sin `stopPropagation`/`stopImmediatePropagation` acá, un solo Escape disparaba AMBOS
    // handlers — cerraba el picker Y el Modal padre (que corre `reset()` y borra lo tipeado).
    // Capturando antes y cortando la propagación, el picker "consume" el Escape primero — bugfix
    // MEDIUM #6 del review adversarial 2026-07-10.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown, true);
    };
    // Los refs son estables entre renders — no hace falta re-suscribir salvo que cambie `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Foco al abrir/cerrar (bugfix LOW #11, review adversarial 2026-07-10): el panel es `role="menu"`
  // pero no movía el foco, así que quien navega solo con teclado no podía llegar a los ítems (el
  // popover se abre pero el foco se queda en el trigger). Al abrir, el foco entra al ícono
  // actualmente elegido (`aria-checked`) o, si ninguno lo está, al primero de la grilla; al cerrar
  // (o desmontar), vuelve al botón que abrió el picker — mismo criterio de "restaurar foco al
  // trigger" que ya usa `Modal` (`components/ui/Modal.tsx`). Alcance acotado a propósito (sin
  // tab-trap dentro del panel): el picker ya se cierra solo con click-afuera/Escape/elegir un ítem.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel?.querySelector<HTMLElement>("button");
    target?.focus();
    return () => {
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Elegir ícono"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-10 items-center justify-center rounded-lg border border-border-strong text-lg transition hover:border-accent"
      >
        {value || "📁"}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: PICKER_WIDTH,
              visibility: coords ? "visible" : "hidden",
            }}
            // z-50: mismo motivo que IconMenu — puede abrirse desde dentro del drawer mobile
            // (z-40) y necesita quedar por encima.
            className="z-50 grid grid-cols-6 gap-1 rounded-xl border border-border bg-surface p-2 shadow-lg"
          >
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                role="menuitemradio"
                aria-checked={value === e}
                aria-label={`Ícono ${e}`}
                onClick={() => {
                  onChange(e);
                  setOpen(false);
                }}
                className={`rounded p-1 text-lg transition hover:bg-surface-secondary ${value === e ? "bg-accent-subtle" : ""}`}
              >
                {e}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
