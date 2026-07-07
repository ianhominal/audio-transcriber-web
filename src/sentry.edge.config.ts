import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrub";

/**
 * Inicialización de Sentry para el runtime Edge (`proxy.ts`/middleware de Supabase, y cualquier
 * ruta marcada `export const runtime = "edge"`). Se importa condicionalmente desde
 * `instrumentation.ts`. Mismas reglas que `sentry.server.config.ts`: sin `SENTRY_DSN` el SDK
 * queda desactivado (no-op).
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  tracesSampleRate: 0.1,
  sendDefaultPii: false,

  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
