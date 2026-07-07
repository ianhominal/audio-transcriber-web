import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrub";

/**
 * Inicialización de Sentry para el runtime Node.js (Route Handlers, Server Actions, Server
 * Components, cron jobs). Se importa condicionalmente desde `instrumentation.ts`.
 *
 * Sin `SENTRY_DSN` configurado, `Sentry.init` queda con `dsn: undefined` — el SDK se comporta
 * como no-op (no crashea, no manda nada). Es el estado por defecto hoy, no lo tratamos como caso
 * de error.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  // Muestreo bajo: solo observabilidad de errores, no queremos gastar cuota en tracing.
  tracesSampleRate: 0.1,

  // Nunca mandar IP, headers ni cookies "por default" — el scrubbing de `beforeSend` es la
  // segunda capa de defensa, esta es la primera (evita que el SDK los adjunte de entrada).
  sendDefaultPii: false,

  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
