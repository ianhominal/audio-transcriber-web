"use client";

import { useEffect, useRef, useState } from "react";

// Set curado de emojis útiles para proyectos (cero dependencias, offline).
const EMOJIS = [
  "📁", "📂", "🗂️", "📝", "📄", "📌",
  "💼", "🎓", "🎧", "🎙️", "🎵", "💡",
  "🚀", "⭐", "❤️", "🔥", "✅", "🎯",
  "🗓️", "💬", "📞", "🛒", "✈️", "🏠",
  "🏢", "💻", "📱", "🧠", "⚙️", "🔒",
  "🌍", "🎨", "📊", "💰", "🐾", "🍔",
];

export function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Elegir ícono"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-10 items-center justify-center rounded-lg border border-slate-300 text-lg transition hover:border-brand-400"
      >
        {value || "📁"}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 grid w-56 grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
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
        </div>
      )}
    </div>
  );
}
