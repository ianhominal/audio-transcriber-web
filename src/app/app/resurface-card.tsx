"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { formatRelativeTime, pickResurfaceCandidate, type ResurfaceCandidate } from "@/lib/resurface";

/** Clave de `localStorage` con los ids de notas que la usuaria ya descartó de la card de
 * resurfacing en ESTE dispositivo — no hay columna `dismissed_at` (evita una migración para un
 * quick win), así que el descarte es puramente client-side y por dispositivo. Descartar una nota
 * no la borra de la selección para siempre: solo hace que `pickResurfaceCandidate` pase a la
 * siguiente más vieja del lote (ver `src/lib/resurface.ts`). */
const DISMISSED_KEY = "resurface-dismissed-ids";

type Candidate = ResurfaceCandidate & { title: string; text: string; audio_name: string };

/**
 * `localStorage` es una fuente externa a React (no estado propio del componente) — por eso se
 * lee/escribe vía `useSyncExternalStore` en vez de `useEffect` + `setState` (el patrón viejo dispara
 * un setState síncrono dentro de un efecto, que el linter de este repo — `eslint-plugin-react-hooks`
 * más nuevo — marca como anti-patrón: "you might not need an Effect"). Ventaja extra, no solo
 * estilística: `useSyncExternalStore` resuelve gratis el problema de SSR/hidratación — usa
 * `getServerSnapshot` (siempre `[]`, sin tocar `window`) en el server Y en el primer render del
 * cliente durante la hidratación, y React mismo dispara el re-render con el snapshot REAL del
 * cliente apenas termina de hidratar, sin flash manual ni bandera "ready" a mano.
 */
const EMPTY_DISMISSED: Set<string> = new Set();
let cachedDismissed: Set<string> | null = null;
const listeners = new Set<() => void>();

function readDismissedIdsFromStorage(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    // localStorage puede fallar (modo privado, cuota) — sin descartes previos, no bloquea nada.
    return new Set();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot(): Set<string> {
  if (cachedDismissed === null) cachedDismissed = readDismissedIdsFromStorage();
  return cachedDismissed;
}

function getServerSnapshot(): Set<string> {
  return EMPTY_DISMISSED;
}

/** Marca una nota como descartada: actualiza el cache en memoria, persiste en `localStorage`
 * (best-effort) y notifica a cualquier suscriptor de `useSyncExternalStore` montado. */
function dismissNote(id: string): void {
  const next = new Set(getSnapshot());
  next.add(id);
  cachedDismissed = next;
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Best-effort: si no se puede persistir, la card puede volver a aparecer en la próxima
    // visita — molesto, pero nunca rompe nada.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Card sutil de "resurfacing" arriba de la lista del dashboard (quick win del brainstorm
 * "Mantener vivo el archivo", ver ROADMAP.md): invita a revisitar una nota vieja.
 *
 * `candidates` llega del server component (`page.tsx`) ya scopeado por RLS + filtrado por
 * antigüedad mínima (`fetchResurfaceCandidates`) — la selección FINAL (cuál de esas se muestra)
 * pasa acá, en el cliente, porque es el único lugar que conoce los descartes de `localStorage`.
 */
export function ResurfaceCard({ candidates }: { candidates: Candidate[] }) {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (candidates.length === 0) return null;

  const pick = pickResurfaceCandidate(candidates, dismissed);
  if (!pick) return null;

  const displayTitle = pick.title || pick.audio_name;
  const snippet = pick.text.trim().slice(0, 140);

  return (
    <div
      role="note"
      aria-label="Nota vieja para revisitar"
      className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3"
    >
      <span aria-hidden="true" className="text-lg leading-none">
        💡
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-tertiary">{formatRelativeTime(pick.created_at)} capturaste esto</p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">{displayTitle}</p>
        {snippet && <p className="mt-0.5 line-clamp-2 text-xs text-secondary">{snippet}</p>}
        <div className="mt-2 flex items-center gap-3">
          <Link href={`/app/t/${pick.id}`} className="text-xs font-semibold text-accent hover:underline">
            Ver de nuevo
          </Link>
          <button
            type="button"
            onClick={() => dismissNote(pick.id)}
            className="text-xs text-tertiary transition hover:text-secondary"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
