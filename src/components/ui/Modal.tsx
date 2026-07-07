"use client";

import { useEffect, type ReactNode } from "react";

/** Modal centrado con overlay: cierra con Escape o click afuera (si `closeOnBackdrop`). */
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}
