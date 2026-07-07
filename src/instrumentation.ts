import * as Sentry from "@sentry/nextjs";

/**
 * Hook de instrumentación de Next.js: se ejecuta una sola vez al arrancar cada runtime del
 * servidor. Acá registramos Sentry para Node.js y Edge por separado, porque cada uno usa un
 * build distinto del SDK (no se pueden importar juntos en el mismo bundle).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Captura errores de Server Components, Route Handlers y el proxy (middleware). */
export const onRequestError = Sentry.captureRequestError;
