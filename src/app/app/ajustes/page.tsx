import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";
import { getDriveConnectionStatusCompat } from "@/lib/drive/connection-status-compat";
import { getUserSettings } from "@/lib/settings/user-settings";
import { listVocabularyTerms } from "@/lib/vocabulary/store";
import { ThemeToggle } from "@/components/theme-toggle";
import { DriveFolderConnect } from "./drive-folder-connect";
import { TranscriptionDefaultsSection } from "./transcription-defaults";
import { VocabularySection } from "./vocabulary-section";

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
  // Independiente de los defaults de transcripción y del vocabulario — se piden en paralelo, no
  // encadenados.
  const [connectionStatus, transcriptionDefaults, vocabularyTerms] = user
    ? await Promise.all([
        getDriveConnectionStatusCompat(supabase, user.id),
        getUserSettings(supabase, user.id),
        listVocabularyTerms(supabase, user.id),
      ])
    : [null, null, []];
  const isConnected = connectionStatus !== null;
  const isRevoked = connectionStatus === "revoked";

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
    </div>
  );
}
