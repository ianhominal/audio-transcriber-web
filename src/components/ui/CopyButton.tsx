"use client";

import { useEffect, useRef, useState } from "react";
import { Button, type ButtonSize } from "./Button";
import { useToast } from "./Toast";
import { copyRichText } from "@/lib/clipboard";

const FEEDBACK_MS = 1800;

type CopyButtonProps = {
  /** Markdown/plain source to copy — gets rendered to sanitized HTML for the rich `text/html`
   *  clipboard representation (see `copyRichText`) and copied as-is for `text/plain`. */
  text: string;
  /** Visible + accessible label while idle. Defaults to "Copiar". */
  label?: string;
  /** aria-label override for when `label` alone isn't descriptive enough in context (e.g. several
   *  "Copiar" buttons on the same page) — falls back to `label`. */
  ariaLabel?: string;
  size?: ButtonSize;
  className?: string;
};

/**
 * Shared "Copiar" button used for the transcription, the summary, and each chat response. Copies
 * BOTH a rendered `text/html` (structure preserved for Docs/Notion/mail) and a `text/plain`
 * fallback via `copyRichText`, shows a transient "Copiado ✓" (visible label + an `aria-live`
 * region so screen readers get it too), and toasts an error if the browser refused/couldn't copy
 * — same error copy already used by the standalone `CopyButton` in `ajustes/mcp-tokens-section.tsx`.
 */
export function CopyButton({ text, label = "Copiar", ariaLabel, size = "sm", className }: CopyButtonProps) {
  const { show: toast } = useToast();
  const [state, setState] = useState<"idle" | "copying" | "copied">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  async function handleCopy() {
    // Limpia un timer anterior antes de programar uno nuevo (bugfix LOW, review adversarial
    // 2026-07-11): sin esto, dos clicks seguidos en menos de FEEDBACK_MS dejaban corriendo el
    // timer viejo, que apagaba el "Copiado ✓" del segundo click antes de tiempo.
    if (timerRef.current) clearTimeout(timerRef.current);
    setState("copying");
    const ok = await copyRichText(text);
    if (ok) {
      setState("copied");
      timerRef.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
    } else {
      setState("idle");
      toast("No se pudo copiar — seleccioná el texto manualmente.", "error");
    }
  }

  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        variant="secondary"
        size={size}
        loading={state === "copying"}
        onClick={handleCopy}
        aria-label={ariaLabel ?? label}
        className={className}
      >
        {state === "copied" ? "Copiado ✓" : label}
      </Button>
      {/* Región viva solo para lectores de pantalla: el label del botón ya cambia visualmente a
          "Copiado ✓", pero ese cambio de texto no se anuncia solo sin un `aria-live` — mismo
          criterio que el resto de la app (ver `role="status"` del panel de Resumen). */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Copiado al portapapeles." : ""}
      </span>
    </span>
  );
}
