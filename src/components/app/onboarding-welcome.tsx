"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import { ONBOARDING_SEEN_KEY, shouldShowOnboarding } from "@/lib/onboarding";

/**
 * "Seen" state is `localStorage`-only, per-device — no `user_settings` column/migration for it
 * (same tradeoff already accepted by `resurface-card.tsx`'s `DISMISSED_KEY`: a quick win that
 * avoids a migration, at the cost of onboarding potentially reappearing on a different
 * device/browser for the same account). Read/write via `useSyncExternalStore` instead of
 * `useEffect` + `setState`, same reasoning as `resurface-card.tsx`: this repo's
 * `eslint-plugin-react-hooks` flags the effect+setState pattern as an anti-pattern, and
 * `useSyncExternalStore` resolves SSR/hydration for free via `getServerSnapshot` (see below).
 */
let cachedSeen: boolean | null = null;
const listeners = new Set<() => void>();

function readSeenFromStorage(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
  } catch {
    // localStorage can throw (private mode, quota) — treat as "not seen", worst case the
    // welcome shows again, it never blocks anything.
    return false;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot(): boolean {
  if (cachedSeen === null) cachedSeen = readSeenFromStorage();
  return cachedSeen;
}

function getServerSnapshot(): boolean {
  // Safe SSR default: "not seen yet" — same tradeoff already accepted by
  // `resurface-card.tsx`'s `getServerSnapshot` for its dismissed-ids set.
  return false;
}

/** Marks onboarding as seen: updates the in-memory cache, persists to `localStorage`
 * (best-effort) and notifies any mounted `useSyncExternalStore` subscriber. Exported so both the
 * primary CTA and the skip control can call it directly. */
export function markOnboardingSeen(): void {
  cachedSeen = true;
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  } catch {
    // Best-effort: if it can't persist, the welcome may show again next visit — annoying, never
    // breaking.
  }
  listeners.forEach((listener) => listener());
}

/**
 * First-time welcome shown instead of (above) the plain empty state when a brand-new account has
 * zero notes ever. The PARENT (`page.tsx`) only decides whether this component is a candidate at
 * all (never mounted on a filtered/tagged view); `hasAnyNotes` (account-wide, not the current
 * filter/tag) is passed through as a real prop so `shouldShowOnboarding` — combined with the
 * client-only "seen" flag — is the single, actually-called source of truth for visibility,
 * instead of splitting the decision across two untested call sites. Returns `null` once
 * shown-and-dismissed (or once there are notes), so the regular `EmptyState` underneath remains
 * the fallback.
 */
export function OnboardingWelcome({
  hasAnyNotes,
  recordHref,
  uploadHref,
}: {
  hasAnyNotes: boolean;
  recordHref: string;
  uploadHref: string;
}) {
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!shouldShowOnboarding({ hasAnyNotes, seen })) return null;

  return (
    <div
      role="region"
      aria-label="Bienvenida"
      className="relative mb-6 rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-10 text-center sm:px-10 sm:py-12"
    >
      <div
        className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background"
        aria-hidden="true"
      >
        <Icon name="wave" size={28} />
      </div>
      <h2 className="text-xl font-bold text-foreground">¡Bienvenido/a a tu archivo de voz!</h2>
      <p className="mt-1 text-sm text-tertiary">Así funciona, en 3 pasos:</p>

      <ol className="mx-auto mt-6 flex max-w-2xl flex-col gap-4 text-left sm:flex-row sm:gap-3">
        <li className="flex-1 rounded-xl border border-border bg-surface-secondary p-4">
          <Icon name="mic" size={20} className="text-tertiary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Grabá o subí un audio</p>
          <p className="mt-1 text-xs text-secondary">Una idea, una reunión, una nota mental: lo que se te ocurra.</p>
        </li>
        <li className="flex-1 rounded-xl border border-border bg-surface-secondary p-4">
          <Icon name="write" size={20} className="text-tertiary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Se transcribe solo</p>
          <p className="mt-1 text-xs text-secondary">En segundos tenés el texto completo, sin tipear nada.</p>
        </li>
        <li className="flex-1 rounded-xl border border-border bg-surface-secondary p-4">
          <Icon name="sparkles" size={20} className="text-tertiary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Procesalo con IA</p>
          <p className="mt-1 text-xs text-secondary">
            Pedile un resumen, chateá sobre la nota, o aplicá un Formato (tu propia receta para convertir la nota en
            un brief, un guion, lo que necesites).
          </p>
        </li>
      </ol>

      <p className="mx-auto mt-6 flex max-w-lg items-start justify-center gap-1.5 text-sm text-secondary">
        <Icon name="resurface" size={16} className="mt-0.5 shrink-0" />
        <span>
          Los Formatos y el chat con IA son lo que más le va a cambiar la cabeza — dales una oportunidad apenas
          tengas tu primera nota.
        </span>
      </p>

      <div className="mt-7 flex flex-col items-center gap-3">
        <Link
          href={recordHref}
          onClick={markOnboardingSeen}
          className={`${buttonClasses({ size: "lg" })} inline-flex items-center gap-1.5`}
        >
          <Icon name="mic" /> Grabá tu primera nota
        </Link>
        <Link
          href={uploadHref}
          onClick={markOnboardingSeen}
          className="text-sm text-secondary underline-offset-2 hover:text-foreground hover:underline"
        >
          o subí un audio ya grabado
        </Link>
      </div>

      {/* Placed LAST in DOM order (moved after the welcome content + CTAs) on purpose: a
          keyboard/screen-reader user tabbing through this region should reach the actual welcome
          content before the dismiss control, not land on "skip" as their very first stop. Stays
          visually pinned top-right via absolute positioning regardless of DOM order. */}
      <button
        type="button"
        onClick={markOnboardingSeen}
        className="absolute right-4 top-4 text-xs text-tertiary transition hover:text-secondary"
      >
        Ahora no
      </button>
    </div>
  );
}
