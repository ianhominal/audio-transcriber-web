const SIZE_CLASSES = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
} as const;

export type SpinnerSize = keyof typeof SIZE_CLASSES;

/** Spinner circular reutilizable (SVG, sin dependencias) para estados de carga inline o en botones. */
export function Spinner({ size = "sm", className = "" }: { size?: SpinnerSize; className?: string }) {
  return (
    <svg
      className={`animate-spin ${SIZE_CLASSES[size]} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}
