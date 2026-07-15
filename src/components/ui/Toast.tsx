"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };

type ToastContextValue = {
  show: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Bugfix LOW #8 (review adversarial 2026-07-10): paleta hardcodeada a light — en dark el toast se
// veía como una caja blanca/clara flotando sobre el resto de la UI oscura. `info` ya era
// theme-aware (usa los tokens `border`/`surface`/`foreground` de `globals.css`); success/error
// ahora suman variantes `dark:` con fondo tenue (`/15`) y texto claro, mismo criterio de contraste
// que el resto de "cajas" de estado tocadas en este mismo fix.
const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/15 dark:text-emerald-200",
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-200",
  info: "border-border bg-surface text-foreground",
};

const TONE_ICON: Record<ToastTone, IconName> = {
  success: "success",
  error: "error",
  info: "info",
};

let counter = 0;

/**
 * Proveedor de toasts para feedback de acciones (guardado, exportado, error…). Puramente
 * presentacional: no reemplaza ningún manejo de estado existente, solo agrega un canal de
 * notificación que cualquier componente cliente puede disparar con `useToast().show(...)`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, tone, message }]);
      const timer = setTimeout(() => dismiss(id), 4000);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${TONE_CLASSES[t.tone]}`}
          >
            <span className="mt-0.5" aria-hidden="true">
              <Icon name={TONE_ICON[t.tone]} />
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar aviso"
              className="tap-target -my-2 -mr-2 flex shrink-0 items-center justify-center rounded text-current opacity-60 transition hover:opacity-100"
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Hook para disparar toasts desde cualquier componente cliente dentro de `<ToastProvider>`. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback silencioso si se usa fuera del provider — no debería pasar dentro de /app.
    return { show: () => {} };
  }
  return ctx;
}
