"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";

const DISMISSED_KEY = "atw:install-prompt-dismissed";

type Platform = "ios" | "android";

// Chrome/Android fire this event instead of exposing a standard install API.
// Not yet in the DOM lib types, so we declare the shape we actually use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type BannerState = { platform: Platform; deferredPrompt: BeforeInstallPromptEvent | null };

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // localStorage puede fallar en modo privado — no bloqueamos por eso.
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Ignorado — a lo sumo el banner vuelve a aparecer en la próxima visita.
  }
}

// `beforeinstallprompt` is an external, mutable browser signal — read it with
// `useSyncExternalStore` instead of `useEffect` + `setState`, which is the
// pattern React recommends for subscribing to platform APIs without causing
// the extra "cascading render" the effect-based version would trigger on mount.
//
// `getSnapshot` MUST return the same object reference across calls while nothing
// underlying changed — otherwise `useSyncExternalStore` treats every render as a
// change and re-renders forever. `computeSnapshot()` builds a fresh object, but we
// only ever call it (and replace `cachedSnapshot`) from the places that actually
// mutate state: the subscribe event handlers below. `getInstallPromptSnapshot`
// itself just returns the cached reference, never allocates.
let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let cachedSnapshot: BannerState | null = null;
let snapshotInitialized = false;

function computeSnapshot(): BannerState | null {
  if (isStandalone() || isDismissed()) return null;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return { platform: "ios", deferredPrompt: null };
  }
  if (cachedDeferredPrompt) {
    return { platform: "android", deferredPrompt: cachedDeferredPrompt };
  }
  return null;
}

function refreshCachedSnapshot() {
  cachedSnapshot = computeSnapshot();
}

function subscribeToInstallPrompt(onStoreChange: () => void) {
  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    cachedDeferredPrompt = event as BeforeInstallPromptEvent;
    refreshCachedSnapshot();
    onStoreChange();
  };
  // Una vez instalada la PWA, no tiene sentido seguir ofreciendo el banner en esta pestaña.
  const onAppInstalled = () => {
    cachedDeferredPrompt = null;
    refreshCachedSnapshot();
    onStoreChange();
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  };
}

function getInstallPromptSnapshot(): BannerState | null {
  // Primer cálculo perezoso (no se puede hacer a nivel de módulo: usa `navigator`/`window`,
  // que no existen del lado server). Las llamadas siguientes devuelven la MISMA referencia
  // cacheada hasta que un event handler de arriba la reemplace explícitamente.
  if (!snapshotInitialized) {
    snapshotInitialized = true;
    refreshCachedSnapshot();
  }
  return cachedSnapshot;
}

// Nothing to show during SSR / the first client render — matches the real
// client snapshot once React hydrates and subscribes.
function getInstallPromptServerSnapshot(): BannerState | null {
  return null;
}

/**
 * Banner discreto que ayuda a instalar la PWA en el celular. Safari (iOS) no
 * dispara `beforeinstallprompt`, así que ahí mostramos instrucciones manuales
 * ("Compartir" → "Agregar a inicio"). En Chrome/Android capturamos el evento
 * nativo y ofrecemos un botón que dispara el prompt de instalación real.
 */
export function InstallPrompt() {
  const snapshot = useSyncExternalStore(
    subscribeToInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptServerSnapshot
  );
  // Immediate local hide on close/install — the localStorage write itself
  // doesn't re-trigger the external store, so we track dismissal separately.
  const [closedByUser, setClosedByUser] = useState(false);

  if (!snapshot || closedByUser) return null;
  const { platform, deferredPrompt } = snapshot;

  const close = () => {
    markDismissed();
    setClosedByUser(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    cachedDeferredPrompt = null;
    refreshCachedSnapshot();
    close();
  };

  // Portal a `document.body` (mismo patrón que el drawer/IconMenu/EmojiPicker) + `z-20`, por
  // DEBAJO del drawer mobile (z-40), los popovers porteados (z-50) y el Modal (z-60): el banner
  // nunca debe tapar ninguno de esos overlays. Ver jerarquía completa en dashboard-shell.tsx.
  return createPortal(
    <div
      role="status"
      className="animate-toast-in fixed inset-x-4 bottom-4 z-20 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden="true">
        <WaveIcon />
      </span>
      <div className="min-w-0 flex-1 text-sm text-secondary">
        {platform === "ios" ? (
          <p>
            Instalá Audio Transcriber: tocá{" "}
            <Icon name="share" size={14} className="inline-block -translate-y-px text-accent" />{" "}
            <strong className="font-semibold">Compartir</strong> y luego{" "}
            <strong className="font-semibold">&quot;Agregar a inicio&quot;</strong>.
          </p>
        ) : (
          <>
            <p>Instalá Audio Transcriber en tu celular para acceder más rápido, como una app.</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={install}>
              Instalar app
            </Button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Cerrar aviso de instalación"
        className="tap-target -my-2 -mr-2 flex shrink-0 items-center justify-center rounded text-tertiary transition-colors duration-150 ease-out hover:text-secondary"
      >
        <Icon name="close" />
      </button>
    </div>,
    document.body
  );
}

function WaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {[8, 14, 20, 14, 10].map((h, i) => (
        <rect key={i} x={4 + i * 4 - 1.5} y={12 - h / 2} width="3" height={h} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}
