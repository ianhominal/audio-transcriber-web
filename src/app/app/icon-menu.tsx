"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MENU_WIDTH = 192; // w-48 (12rem)
const VIEWPORT_MARGIN = 8;

/**
 * Botón "⋯" con un popover. `children` es una render-prop que recibe `close`
 * para cerrar el menú desde cada opción.
 *
 * El menú se renderiza en un portal a `document.body` con `position: fixed`, calculando su
 * posición a partir del botón. Esto es necesario porque este componente se usa dentro de
 * contenedores con `overflow-y-auto` (el sidebar de proyectos, doc del bug de recorte): un
 * `position: absolute`/`fixed` normal igual queda recortado por el `overflow` del ancestro aunque
 * tenga mayor `z-index` — solo escapar del árbol del DOM vía portal evita el recorte.
 */
export function IconMenu({
  children,
  label = "Opciones",
}: {
  children: (close: () => void) => ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setCoords(null);
  }

  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 0;

      let left = rect.right - MENU_WIDTH;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN));

      let top = rect.bottom + 4;
      if (menuHeight && top + menuHeight > window.innerHeight - VIEWPORT_MARGIN) {
        // No entra debajo del botón: lo mostramos arriba en su lugar.
        top = Math.max(VIEWPORT_MARGIN, rect.top - menuHeight - 4);
      }
      setCoords({ top, left });
    }

    // Primer cálculo (posiciona fuera de pantalla hasta medir la altura real del menú).
    reposition();

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: MENU_WIDTH,
              visibility: coords ? "visible" : "hidden",
            }}
            className="z-30 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg"
          >
            {children(close)}
          </div>,
          document.body
        )}
    </div>
  );
}

/** Ítem estándar de menú. */
export function MenuItem({
  onClick,
  children,
  danger = false,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`block w-full rounded-md px-3 py-1.5 text-left transition hover:bg-slate-100 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
