import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrub";

/**
 * Inicialización de Sentry para el navegador. Next.js carga este archivo automáticamente ni bien
 * arranca la app (convención `instrumentation-client.ts`, no requiere importarlo a mano).
 *
 * Deliberadamente NO agregamos `Sentry.replayIntegration()` (Session Replay): grabaría la
 * pantalla del usuario, que puede tener el texto de una transcripción privada a la vista. El
 * costo en fidelidad de debugging es aceptable frente a ese riesgo de privacidad.
 *
 * Sin `NEXT_PUBLIC_SENTRY_DSN` configurado, el SDK queda desactivado (no-op) — estado por
 * defecto hoy, la app funciona igual.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  tracesSampleRate: 0.1,
  sendDefaultPii: false,

  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});

// Requerido por Sentry para capturar errores de navegación en App Router (Next.js 14.3+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
