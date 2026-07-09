"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * Error boundary global de Next.js (App Router): se activa cuando falla el `RootLayout` mismo,
 * el último recurso antes de que no haya nada para renderizar. Reemplaza <html>/<body> enteros,
 * así que NO hereda nada del layout (ni fuentes ni CSS) — por eso importa `globals.css` y vuelve
 * a declarar la fuente Geist acá de nuevo, igual que `layout.tsx`. Sin el import de CSS, las
 * clases de Tailwind quedan sin compilar/enlazar en esta página y se ve como HTML plano; sin la
 * fuente, cae al fallback del navegador. Sin `Sentry.captureException`, estos errores no
 * llegarían a Sentry.
 *
 * Nota de theming: como este árbol reemplaza `<html>/<body>` por completo, tampoco hereda el
 * `ThemeProvider` de `next-themes` (que vive en el `RootLayout` normal) ni la clase `.dark` que
 * inyecta — usa los tokens semánticos (`bg-background`, `text-foreground`, etc.) pero siempre
 * resuelven a sus valores LIGHT acá, sin importar el tema elegido por el usuario. Path de error
 * poco frecuente y sigue siendo perfectamente legible en claro, así que se acepta como limitación
 * conocida en vez de sumar un script de detección de tema propio a este boundary de último
 * recurso.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es" className={`${geistSans.variable} antialiased`}>
      <body className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">
            ⚠️
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">Algo salió mal.</h1>
          <p className="mt-2 text-sm text-secondary">
            Ya nos enteramos del error. Probá de nuevo — si sigue pasando, volvé más tarde.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Reintentar
            </button>
            {/* Anchor nativo a propósito, no `next/link`: este boundary es el último recurso
                cuando el propio root layout se rompió, así que no debe depender del router de
                Next (que podría ser justamente lo que falló) — una navegación de browser plana
                siempre funciona. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-medium text-secondary transition hover:bg-surface-secondary"
            >
              Volver al inicio
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
