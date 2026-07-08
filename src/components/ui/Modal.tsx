"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { lockBodyScroll } from "@/lib/scrollLock";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal con overlay: cierra con Escape o click afuera (si `closeOnBackdrop`).
 *
 * Responsive: en mobile (`<sm`) se comporta como bottom-sheet (pegado abajo, ancho completo,
 * esquinas redondeadas arriba, sube con animación y se puede cerrar deslizando el handle hacia
 * abajo); en `sm+` sigue siendo el dialog centrado de siempre. Retrocompatible: todos los usos
 * existentes (`NewSubfolderButton`, `DriveFolderConnect`, etc.) funcionan sin cambios.
 *
 * Maneja foco (focus-trap: el foco entra al abrir, Tab no se escapa del diálogo, vuelve al
 * disparador al cerrar) y scroll-lock (bloquea el scroll del body mientras está abierto).
 */
export function Modal({
  onClose,
  children,
  labelledBy,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragDeltaY = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll-lock: bloquea el scroll del body mientras el modal está abierto, así en mobile no se
  // arrastra el fondo por debajo del bottom-sheet. Contador compartido con el drawer mobile (ver
  // `lib/scrollLock.ts`): si el Modal se abre anidado dentro del drawer, cerrar uno no restaura
  // el scroll mientras el otro siga abierto.
  useEffect(() => {
    return lockBodyScroll();
  }, []);

  // Focus-trap: el foco entra al primer elemento enfocable al abrir, Tab/Shift+Tab quedan
  // atrapados dentro del panel, y el foco vuelve al elemento que abrió el modal al cerrar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Respeta el `autoFocus` nativo de un elemento del contenido (ej. el `<input autoFocus/>` de
    // `NewSubfolderButton`/`transcription-row`) en vez de siempre saltar al primer focusable en
    // orden DOM — si no hay ninguno con `autofocus`, cae al comportamiento anterior.
    const autoFocusTarget = panel?.querySelector<HTMLElement>("[autofocus]");
    const firstFocusable = autoFocusTarget ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  // Deslizar hacia abajo para cerrar: solo el handle del bottom-sheet (`sm:hidden`) escucha touch,
  // así no interfiere con el scroll interno del contenido del modal.
  function onHandleTouchStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0].clientY;
    dragDeltaY.current = 0;
  }

  function onHandleTouchMove(e: React.TouchEvent) {
    if (dragStartY.current === null || !panelRef.current) return;
    const delta = Math.max(0, e.touches[0].clientY - dragStartY.current);
    dragDeltaY.current = delta;
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateY(${delta}px)`;
  }

  function onHandleTouchEnd() {
    const panel = panelRef.current;
    dragStartY.current = null;
    if (!panel) return;
    const shouldClose = dragDeltaY.current > 80;
    panel.style.transition = "transform 150ms ease-out";
    panel.style.transform = shouldClose ? "translateY(100%)" : "translateY(0)";
    dragDeltaY.current = 0;
    if (shouldClose) setTimeout(onClose, 150);
  }

  // Jerarquía de z-index de la app (de abajo hacia arriba): InstallPrompt (z-20) < drawer mobile
  // (z-40, `dashboard-shell.tsx`) < popovers porteados como IconMenu/EmojiPicker (z-50) < Modal
  // (acá, z-[60]). El Modal es el overlay más alto: nunca debe quedar tapado por un popover o el
  // drawer, aunque se abra anidado dentro de ellos.
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 sm:items-center sm:px-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pt-2 shadow-xl outline-none sm:max-h-[85vh] sm:w-full sm:max-w-md sm:animate-none sm:rounded-2xl sm:pt-5"
      >
        <div
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
          className="-mx-5 -mt-2 mb-3 flex justify-center pt-2 pb-3 sm:hidden"
          aria-hidden="true"
        >
          <span className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>
        {children}
      </div>
    </div>
  );
}
