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
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
    // Los refs son estables entre renders — no hace falta re-suscribir salvo que cambie `open`.
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
        className="flex h-9 w-10 items-center justify-center rounded-lg border border-slate-300 text-lg transition hover:border-brand-400"
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
            className="z-50 grid grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
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
                className={`rounded p-1 text-lg transition hover:bg-slate-100 ${value === e ? "bg-brand-100" : ""}`}
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
