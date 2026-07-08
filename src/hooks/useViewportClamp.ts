"use client";

import { useLayoutEffect, useRef, useState } from "react";

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;

export type ClampedCoords = { top: number; left: number } | null;

/**
 * Posiciona un panel flotante (menú/popover) anclado a un botón trigger, clampeado a los bordes
 * del viewport en ambos ejes. Pensado para usar junto con un portal a `document.body`: así el
 * panel escapa del `overflow` de cualquier ancestro (sidebar con scroll, card angosta, etc.) — ver
 * el comentario histórico en `icon-menu.tsx` sobre por qué un `position: absolute`/`fixed` normal
 * igual queda recortado si el ancestro tiene `overflow: auto/hidden`, sin importar el `z-index`.
 *
 * Extraído de `IconMenu` (que fue el primer lugar donde se resolvió este problema) para
 * reusarlo en cualquier popover viewport-aware: el menú "Exportar" de `transcription-detail.tsx`
 * y el selector de emoji de `emoji-picker.tsx` tenían el mismo riesgo de desborde en mobile
 * (`absolute left-0` sin clamp), solo que ahí el síntoma es horizontal (se salen por el borde
 * derecho de una pantalla angosta) además del vertical que ya resolvía `IconMenu`.
 *
 * Horizontal: por default ancla el borde DERECHO del panel al borde derecho del trigger (como el
 * menú "..." de `IconMenu`, que se abre hacia la izquierda desde un botón que suele estar pegado
 * al borde derecho de una fila). Con `align: "left"` ancla el borde IZQUIERDO en su lugar (el
 * menú "Exportar" de `transcription-detail.tsx` y el selector de emoji ya abrían hacia la derecha
 * desde `left-0`, comportamiento que se preserva). En ambos casos se clampea después para que el
 * panel nunca quede fuera de [MARGIN, viewportWidth - MARGIN].
 * Vertical: intenta abrir debajo del trigger; si no entra antes del borde inferior del viewport
 * (medido con la altura real del panel, vía `panelRef`), lo flipea arriba.
 *
 * No maneja abrir/cerrar ni click-afuera/Escape — cada consumidor ya tiene su propia lógica ahí
 * (distinta entre `IconMenu`, el menú de exportar y el selector de emoji), así que esas partes
 * quedan en cada componente. Este hook solo resuelve el `top`/`left`.
 */
export function useViewportClamp(open: boolean, panelWidth: number, options?: { align?: "left" | "right" }) {
  const align = options?.align ?? "right";
  const [coords, setCoords] = useState<ClampedCoords>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Cerrado: no hay nada que posicionar (el panel ni siquiera está montado, ver los `open &&
    // createPortal(...)` de cada consumidor) — no hace falta resetear `coords` acá, se recalcula
    // desde cero apenas vuelve a abrirse (con `visibility: hidden` hasta la primera medición real,
    // así que un valor viejo no llega a verse).
    if (!open) return;

    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panelHeight = panelRef.current?.offsetHeight ?? 0;

      let left = align === "left" ? rect.left : rect.right - panelWidth;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - panelWidth - VIEWPORT_MARGIN));

      let top = rect.bottom + TRIGGER_GAP;
      if (panelHeight && top + panelHeight > window.innerHeight - VIEWPORT_MARGIN) {
        // No entra debajo del botón: lo mostramos arriba en su lugar.
        top = Math.max(VIEWPORT_MARGIN, rect.top - panelHeight - TRIGGER_GAP);
      }
      setCoords({ top, left });
    }

    // Primer cálculo (posiciona fuera de pantalla hasta medir la altura real del panel).
    reposition();

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, panelWidth, align]);

  return { coords, triggerRef, panelRef };
}
