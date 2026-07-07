"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Error boundary global de Next.js (App Router): se activa cuando falla el `RootLayout` mismo,
 * el último recurso antes de que no haya nada para renderizar. Reemplaza <html>/<body> enteros.
 * Sin esto, esos errores no llegarían a Sentry.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <h1>Algo salió mal.</h1>
        <p>Ya nos enteramos del error. Probá recargar la página.</p>
      </body>
    </html>
  );
}
