import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 font-semibold text-white hover:bg-brand-700 disabled:bg-border-strong disabled:text-tertiary",
  secondary: "border border-border-strong bg-surface font-medium text-secondary hover:bg-background disabled:opacity-50",
  ghost: "font-medium text-secondary hover:bg-surface-secondary disabled:opacity-50",
  danger: "bg-red-600 font-semibold text-white hover:bg-red-700 disabled:bg-border-strong disabled:text-tertiary",
  // `dark:` obligatorio: sin él, red-600 sobre la superficie oscura da ~3:1 y no llega a AA. Es el
  // botón "Borrar" de cada nota, proyecto y carpeta. Mismo patrón que ya usan los 8 call sites
  // sueltos de la app (text-red-600 dark:text-red-400) — irónicamente, el primitivo COMPARTIDO era
  // el que no lo tenía.
  "danger-outline":
    "border border-red-200 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/30 dark:text-red-400 dark:hover:bg-red-400/10",
  success: "bg-emerald-600 font-semibold text-white hover:bg-emerald-600 disabled:bg-border-strong disabled:text-tertiary",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-lg px-3 py-1.5 text-xs",
  md: "gap-2 rounded-lg px-4 py-2.5 text-sm",
  lg: "gap-2 rounded-lg px-5 py-3 text-base",
};

/** Genera las clases de un botón/link con look de botón — útil para <Link> que deben verse como botón. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return `inline-flex items-center justify-center transition disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

/** Botón estándar de la app: variantes + tamaños consistentes y estado `loading` con spinner integrado. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const spinnerTone = variant === "primary" || variant === "danger" || variant === "success" ? "text-white/90" : "text-current";
  return (
    <button
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, className })}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={size === "sm" ? "xs" : "sm"} className={spinnerTone} />}
      {children}
    </button>
  );
}
