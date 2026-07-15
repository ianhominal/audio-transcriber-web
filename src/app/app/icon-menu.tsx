"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useViewportClamp } from "@/hooks/useViewportClamp";
import { Icon } from "@/components/ui/icon";

const MENU_WIDTH = 192; // w-48 (12rem)

/**
 * Botón "⋯" con un popover. `children` es una render-prop que recibe `close`
 * para cerrar el menú desde cada opción.
 *
 * El menú se renderiza en un portal a `document.body` con `position: fixed`, posicionado y
 * clampeado al viewport vía `useViewportClamp` (`src/hooks/useViewportClamp.ts`). Esto es
 * necesario porque este componente se usa dentro de contenedores con `overflow-y-auto` (el
 * sidebar de proyectos, doc del bug de recorte): un `position: absolute`/`fixed` normal igual
 * queda recortado por el `overflow` del ancestro aunque tenga mayor `z-index` — solo escapar del
 * árbol del DOM vía portal evita el recorte.
 */
export function IconMenu({
  children,
  label = "Opciones",
}: {
  children: (close: () => void) => ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { coords, triggerRef, panelRef } = useViewportClamp(open, MENU_WIDTH);

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    }
    // Escape en fase de CAPTURA (no bubble) — mismo fix que `EmojiPicker`/`ProjectColorPicker`
    // (bugfix MEDIUM #6, review adversarial 2026-07-10): `TranscriptionRow` abre este menú DENTRO
    // de un `Modal` propio ("Proyecto nuevo…"), y sin esto un Escape cerraba el menú Y el Modal a
    // la vez. Cortar la propagación acá hace que este menú "consuma" el Escape antes de que llegue
    // al listener bubble del Modal.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
    // Los refs (triggerRef/panelRef) son estables entre renders; `close` solo llama a `setOpen`
    // (también estable) — no hace falta re-suscribir salvo que cambie `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Foco al abrir/cerrar (bugfix LOW #11, review adversarial 2026-07-10) — mismo criterio que
  // `EmojiPicker`/`ProjectColorPicker`: al abrir, el foco entra al primer `MenuItem`; al cerrar
  // vuelve al botón "⋯" que abrió el menú.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[role="menuitem"]');
    target?.focus();
    return () => {
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="tap-target flex items-center justify-center rounded-md text-tertiary transition hover:bg-border hover:text-secondary"
      >
        <Icon name="more" />
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
              width: MENU_WIDTH,
              visibility: coords ? "visible" : "hidden",
            }}
            // z-50: por encima del drawer mobile (z-40, `dashboard-shell.tsx`), porque este
            // popover se abre habitualmente desde el sidebar de proyectos que vive DENTRO del
            // drawer en mobile — con z-30 quedaba tapado/inclickeable detrás del drawer.
            className="z-50 rounded-xl border border-border bg-surface p-1 text-sm shadow-lg"
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
      className={`block w-full rounded-md px-3 py-1.5 text-left transition hover:bg-surface-secondary ${
        danger ? "text-red-600 hover:bg-red-50" : "text-secondary"
      }`}
    >
      {children}
    </button>
  );
}
