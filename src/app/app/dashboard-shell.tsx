"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/scrollLock";

/**
 * Envoltorio cliente del sidebar de proyectos del dashboard (`page.tsx`, Server Component, no
 * puede tener estado de abierto/cerrado por sí mismo).
 *
 * - Desktop (`md:` en adelante): sidebar fija de siempre, sin cambios de comportamiento — vive en
 *   un `<aside>` estático dentro del grid de `page.tsx`.
 * - Mobile (`<md`): la sidebar NO ocupa espacio en el flujo (ya no se apila arriba de `<main>`
 *   con scroll anidado `max-h-[65vh]`, que era la mala UX original). En su lugar, un botón
 *   hamburguesa abre un drawer off-canvas (portal a `document.body`, `position: fixed`,
 *   desliza desde la izquierda) con overlay semitransparente atrás.
 *
 * `sidebar` se recibe pre-renderizado desde `page.tsx` (Server Component) y solo se monta DOS
 * veces si el usuario llega a abrir el drawer alguna vez: una instancia siempre montada en el
 * `<aside>` de escritorio (oculta vía CSS con `hidden md:block` — sigue montada en el DOM incluso
 * en mobile, no hay unmount; el ocultamiento es solo visual) y otra que se monta recién cuando
 * `open` es `true` dentro del drawer — cerrado, el drawer no existe en el DOM (sin duplicar
 * listeners/estado de los hijos innecesariamente).
 */
export function DashboardShell({ sidebar }: { sidebar: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  function close() {
    setOpen(false);
  }

  // El drawer y su botón se ocultan con `md:hidden` (CSS), no por unmount. Si el viewport cruza
  // `md` (768px) con el drawer abierto (ej. rotar el teléfono a landscape), el botón de cerrar
  // desaparece pero `open` seguiría en `true` y el scroll-lock nunca se restauraría si no
  // forzamos el cierre acá. Corre siempre (no depende de `open`) para detectar el cruce en
  // cualquier momento.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    function onBreakpointChange(e: MediaQueryListEvent) {
      if (e.matches) close();
    }
    mql.addEventListener("change", onBreakpointChange);
    return () => mql.removeEventListener("change", onBreakpointChange);
  }, []);

  // Bloqueo de scroll del body (contador compartido con `Modal`, ver `lib/scrollLock.ts`: en
  // mobile es normal abrir un Modal anidado dentro del drawer) + manejo de foco mientras el
  // drawer está abierto.
  useEffect(() => {
    if (!open) return;

    const unlockScroll = lockBodyScroll();
    // Copiado del ref acá adentro: para cuando corra el cleanup, `triggerRef.current` puede haber
    // cambiado (ej. si el trigger se desmonta) — el lint de `react-hooks` pide capturar el nodo
    // real en vez de releer el ref en el cleanup.
    const trigger = triggerRef.current;

    const panel = panelRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';
    // Foco inicial dentro del panel (el primer elemento enfocable), para no dejarlo "perdido" en
    // el botón hamburguesa, que queda tapado por el overlay.
    panel?.querySelector<HTMLElement>(focusableSelector)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      // Focus trap simple: Tab/Shift+Tab no se escapan del panel mientras está abierto.
      if (e.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>(focusableSelector);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
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
      unlockScroll();
      document.removeEventListener("keydown", onKeyDown);
      // Devuelve el foco al botón que abrió el drawer.
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      {/* Sidebar de escritorio: sin cambios de comportamiento respecto de antes de este cambio. */}
      <aside className="hidden md:block md:sticky md:top-20">{sidebar}</aside>

      {/* Trigger del drawer, solo visible en mobile (<md). */}
      <div className="mb-4 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="tap-target flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-secondary shadow-sm transition hover:bg-background"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ☰
          </span>
          Proyectos
        </button>
      </div>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-overlay" onClick={close} aria-hidden="true" />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              // Cierra al elegir un proyecto/carpeta/"Todas"/"Sin proyecto" (son <a> de Next Link
              // dentro de `sidebar`) sin tener que tocar esos componentes uno por uno: delega por
              // burbujeo y solo actúa si el click vino de un link real. Los botones internos ("...",
              // "Nuevo proyecto", colapsar/expandir) no son <a>, así que no cierran el drawer.
              // Si el click lleva un modificador (ctrl/cmd/shift) o no fue el botón principal,
              // el usuario está abriendo el link en otro lado (pestaña nueva, ventana nueva) —
              // dejamos pasar el comportamiento nativo del navegador sin cerrar el drawer.
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                if ((e.target as HTMLElement).closest("a[href]")) close();
              }}
              className="animate-drawer-in absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col overflow-y-auto bg-background p-4 shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <p id={titleId} className="text-sm font-semibold text-foreground">
                  Proyectos
                </p>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Cerrar"
                  className="tap-target flex items-center justify-center rounded-lg text-tertiary transition hover:bg-border hover:text-secondary"
                >
                  ✕
                </button>
              </div>
              {sidebar}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
