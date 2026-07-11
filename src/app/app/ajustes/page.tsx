import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";
import { getDriveConnectionStatusCompat } from "@/lib/drive/connection-status-compat";
import { getUserSettings } from "@/lib/settings/user-settings";
import { listVocabularyTerms } from "@/lib/vocabulary/store";
import { listMcpTokens } from "@/lib/mcp-tokens/store";
import { ThemeToggle } from "@/components/theme-toggle";
import { DriveFolderConnect } from "./drive-folder-connect";
import { TranscriptionDefaultsSection } from "./transcription-defaults";
import { VocabularySection } from "./vocabulary-section";
import { MCPTokensSection } from "./mcp-tokens-section";

const DRIVE_STATUS_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Conectado con Google Drive." },
  denied: { tone: "error", text: "Cancelaste el permiso de acceso a Google Drive." },
  "invalid-state": { tone: "error", text: "La conexión expiró o no es válida. Probá de nuevo." },
  "no-refresh-token": {
    tone: "error",
    text: "Google no devolvió el permiso de acceso permanente. Probá reconectar.",
  },
  "config-missing": {
    tone: "error",
    text: "Falta configurar las credenciales de Google en el servidor.",
  },
  error: { tone: "error", text: "No se pudo conectar con Google Drive. Probá de nuevo." },
};

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const { drive: driveStatus } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `status` distingue conexión ACTIVA de token revocado por Google (el usuario existe en
  // `drive_connections` pero ya no sirve) — ver migración `20260707140000_drive_connection_status.sql`
  // y `src/lib/drive/connection-status-compat.ts` (degrada a 'active' si la migración no corrió).
  // Independent of the transcription defaults, vocabulary, and MCP tokens fetches below — all
  // fetched in parallel, not chained.
  const [connectionStatus, transcriptionDefaults, vocabularyTerms, mcpTokens] = user
    ? await Promise.all([
        getDriveConnectionStatusCompat(supabase, user.id),
        getUserSettings(supabase, user.id),
        listVocabularyTerms(supabase, user.id),
        listMcpTokens(supabase, user.id),
      ])
    : [null, null, [], []];
  const isConnected = connectionStatus !== null;
  const isRevoked = connectionStatus === "revoked";

  // Canonical origin for the MCP endpoint URL shown below — pasted verbatim into an external MCP
  // client's config as a long-lived credential-bearing URL, so a STABLE, correct origin matters
  // more here than for a one-off redirect. There is no `NEXT_PUBLIC_SITE_URL` or equivalent custom
  // env var in this project (verified before writing this).
  //
  // Preference order: (1) on Vercel, `VERCEL_PROJECT_PRODUCTION_URL` — a system env var, set at
  // both build and runtime, domain-only (no protocol scheme), always the project's shortest
  // production custom domain (or *.vercel.app if none) and — per Vercel's own docs — "always set,
  // even in preview deployments" — so the URL shown is always the stable production endpoint,
  // never a throwaway preview domain. (2) Fall back to reading the request's own `host`/
  // `x-forwarded-proto` headers (the same data `req.nextUrl.origin` gives a route handler, but
  // this is a Server Component with no direct `req`, so `headers()` — async since Next 15+, same
  // as `cookies()` in `src/lib/supabase/server.ts` — is the idiomatic way to get it) for local dev
  // (no such env var exists there) and for any non-Vercel deployment, so `npm run dev` and
  // self-hosting both keep working unchanged.
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol = headersList.get("x-forwarded-proto") ?? (isLocalHost ? "http" : "https");
  const mcpEndpointUrl =
    !isLocalHost && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/mcp`
      : `${protocol}://${host}/api/mcp`;

  const message = driveStatus ? DRIVE_STATUS_MESSAGES[driveStatus] : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Ajustes</h1>
      <p className="mt-1 text-sm text-tertiary">Preferencias de tu cuenta e integraciones.</p>

      {message && (
        <div
          role="status"
          className={`mt-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/15 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-200"
          }`}
        >
          <span aria-hidden="true">{message.tone === "ok" ? "✓" : "✕"}</span>
          <span>{message.text}</span>
        </div>
      )}

      {/* Apariencia: el selector de tema (claro/sistema/oscuro) vivía suelto en el header del
          dashboard (`app/layout.tsx`) — se movió acá para que sea una opción más de Ajustes,
          integrada con el resto (Transcripción, Google Drive). El control sigue siendo el mismo
          `ThemeToggle` (next-themes + guard de `mounted` contra hydration mismatch). */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-lg" aria-hidden="true">
              🎨
            </span>
            <div>
              <h2 className="font-semibold text-foreground">Apariencia</h2>
              <p className="text-sm text-tertiary">Elegí cómo se ve la app.</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {transcriptionDefaults && (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <TranscriptionDefaultsSection initialDefaults={transcriptionDefaults} />
        </section>
      )}

      {user && (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <VocabularySection initialTerms={vocabularyTerms} />
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-lg" aria-hidden="true">
            ☁️
          </span>
          <div>
            <h2 className="font-semibold text-foreground">Google Drive</h2>
            <p className="text-sm text-tertiary">
              Conectá tu cuenta para que tus transcripciones se mantengan sincronizadas con Drive automáticamente.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isConnected && !isRevoked ? (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
              <span aria-hidden="true">✓</span> Google Drive conectado
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {isRevoked && (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
                  <span aria-hidden="true">⚠️</span> Se venció el permiso de Google Drive
                </p>
              )}
              <a href="/api/drive/connect" className={buttonClasses({ size: "md" })}>
                {isRevoked ? "Reconectá Google Drive" : "Conectar Google Drive"}
              </a>
            </div>
          )}
        </div>

        {isConnected && !isRevoked && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm text-tertiary">
              Conectá una carpeta existente para traerla con toda su jerarquía de subcarpetas y notas.
            </p>
            <div className="mt-3">
              <DriveFolderConnect />
            </div>
          </div>
        )}
      </section>

      {user && (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <MCPTokensSection initialTokens={mcpTokens} mcpEndpointUrl={mcpEndpointUrl} />
        </section>
      )}
    </div>
  );
}
