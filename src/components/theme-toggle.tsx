"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Icon, type IconName } from "@/components/ui/icon";

// Nada que suscribir de verdad — este store no tiene estado externo real, solo existe
// para forzar el patrón `useSyncExternalStore` (server snapshot `false`, client snapshot
// `true`) y así detectar "ya estamos montados en el cliente" sin el `useEffect` +
// `setState` síncrono que dispara `react-hooks/set-state-in-effect` (mismo problema que
// ya resolvió `install-prompt.tsx` en este repo, ver el comentario ahí). `subscribe` no
// necesita notificar nunca: el valor no cambia después del primer render cliente.
function subscribeNoop() {
  return () => {};
}
function getMountedClientSnapshot() {
  return true;
}
function getMountedServerSnapshot() {
  return false;
}
function useMounted() {
  return useSyncExternalStore(subscribeNoop, getMountedClientSnapshot, getMountedServerSnapshot);
}

type ThemeOption = "light" | "system" | "dark";

const OPTIONS: { value: ThemeOption; label: string; icon: IconName }[] = [
  { value: "light", label: "Claro", icon: "sun" },
  { value: "system", label: "Sistema", icon: "system" },
  { value: "dark", label: "Oscuro", icon: "moon" },
];

/**
 * Selector de tema de 3 vías (claro/sistema/oscuro), persistente vía `next-themes`
 * (localStorage + atributo `class` en `<html>`, ver `ThemeProvider` en `layout.tsx`).
 *
 * `theme`/`resolvedTheme` no existen en el server ni en el primer render del cliente
 * (next-themes los resuelve recién después de montar, para no depender de leer
 * `localStorage` durante SSR). Si renderizáramos el ícono activo antes de eso, el HTML
 * del server no coincidiría con el del cliente → hydration mismatch. Guard `mounted` vía
 * `useSyncExternalStore` (mismo patrón que ya usa `install-prompt.tsx` en este repo) en
 * vez de `useEffect` + `setState` — ese último dispara el lint `react-hooks/set-state-in-effect`
 * ("Calling setState synchronously within an effect can trigger cascading renders").
 */
export function ThemeToggle() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();

  if (!mounted) {
    // Placeholder de mismo tamaño que el control real, así no hay salto de layout
    // (CLS) cuando el guard de arriba se resuelve tras el primer paint.
    return <div className="h-11 w-[8.25rem] shrink-0 rounded-lg bg-surface-secondary" aria-hidden="true" />;
  }

  return (
    <div role="group" aria-label="Tema" className="inline-flex shrink-0 gap-0.5 rounded-lg border border-border bg-surface-secondary p-0.5">
      {OPTIONS.map(({ value, label, icon }) => {
        const active = (theme ?? "system") === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={`Tema ${label.toLowerCase()}`}
            title={label}
            onClick={() => setTheme(value)}
            className={`tap-target flex items-center justify-center rounded-md transition-colors duration-150 ease-out ${
              active ? "bg-surface text-accent shadow-sm" : "text-tertiary hover:text-secondary"
            }`}
          >
            <Icon name={icon} className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
