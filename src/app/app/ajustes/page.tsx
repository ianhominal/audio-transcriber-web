import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";
import { getDriveConnectionStatusCompat } from "@/lib/drive/connection-status-compat";
import { DriveFolderConnect } from "./drive-folder-connect";

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
  const connectionStatus = user ? await getDriveConnectionStatusCompat(supabase, user.id) : null;
  const isConnected = connectionStatus !== null;
  const isRevoked = connectionStatus === "revoked";

  const message = driveStatus ? DRIVE_STATUS_MESSAGES[driveStatus] : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ajustes</h1>
      <p className="mt-1 text-sm text-slate-500">Preferencias de tu cuenta e integraciones.</p>

      {message && (
        <div
          role="status"
          className={`mt-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <span aria-hidden="true">{message.tone === "ok" ? "✓" : "✕"}</span>
          <span>{message.text}</span>
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-lg" aria-hidden="true">
            ☁️
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">Google Drive</h2>
            <p className="text-sm text-slate-500">
              Conectá tu cuenta para que tus transcripciones se mantengan sincronizadas con Drive automáticamente.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isConnected && !isRevoked ? (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              <span aria-hidden="true">✓</span> Google Drive conectado
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {isRevoked && (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
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
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-500">
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
