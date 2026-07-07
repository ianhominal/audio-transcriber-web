import type { ReactNode } from "react";

/** Estado vacío con call-to-action, para listas/paneles sin contenido todavía. */
export function EmptyState({
  icon = "🗂️",
  title,
  description,
  action,
  className = "",
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center ${className}`}>
      <div
        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-2xl"
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="font-semibold text-slate-800">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
