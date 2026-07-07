import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import packageJson from "./package.json";

// Release para correlacionar eventos de Sentry con el código desplegado: en Vercel usamos el SHA
// del commit (más preciso que la versión de package.json, que no cambia en cada deploy); en local
// caemos a la versión del package.json.
const sentryRelease = process.env.VERCEL_GIT_COMMIT_SHA ?? packageJson.version;

// Entorno lógico (no confundir con NODE_ENV): "production" | "preview" | "development" en
// Vercel, o "development" en local.
const sentryEnvironment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

const nextConfig: NextConfig = {
  /* config options here */

  // Se inyectan como env vars para que sentry.server.config.ts, sentry.edge.config.ts e
  // instrumentation-client.ts (que corre en el browser) lean el mismo release/environment.
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment,
  },
};

// withSentryConfig envuelve el build de Next.js para instrumentar automáticamente Server
// Components/Route Handlers/proxy y (si hay SENTRY_AUTH_TOKEN) subir sourcemaps a Sentry.
//
// IMPORTANTE: esto se aplica siempre, tenga o no la app un DSN configurado — el DSN solo
// controla si el SDK *envía* eventos en runtime (ver sentry.*.config.ts). Acá lo que nos importa
// es que el build NUNCA falle si falta SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT: en ese caso
// simplemente se desactiva la subida de sourcemaps (los stack traces en Sentry quedan minificados,
// pero el deploy funciona igual).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: sentryRelease },

  // Sin auth token no hay forma de autenticar la subida de sourcemaps: la desactivamos
  // explícitamente en vez de dejar que el plugin lo intente y falle/loguee ruido.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  // Silencioso en local; en CI (Vercel build) sí queremos ver los logs del plugin.
  silent: !process.env.CI,
});
