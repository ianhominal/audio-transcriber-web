import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

// Bugfix LOW #8 (review adversarial 2026-07-10): success/warning/danger usaban paleta light
// hardcodeada (se veían como chips blancos en dark) — `neutral`/`brand` ya eran theme-aware (tokens
// de `globals.css`). Mismo criterio de contraste `dark:` que `Toast.tsx`.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-secondary text-secondary",
  brand: "bg-accent-subtle text-accent-subtle-text",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
  danger: "bg-red-50 text-red-700 dark:bg-red-400/15 dark:text-red-200",
};

/** Etiqueta pequeña de estado/metadato (idioma, modelo, tamaño, estado de sync, etc). */
export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
