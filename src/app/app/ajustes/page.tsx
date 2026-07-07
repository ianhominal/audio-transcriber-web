import { createClient } from "@/lib/supabase/server";

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

  const { data: connection } = user
    ? await supabase
        .from("drive_connections")
        .select("connected_at")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const message = driveStatus ? DRIVE_STATUS_MESSAGES[driveStatus] : null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Ajustes</h1>

      {message && (
        <div
          className={`mt-4 rounded-lg border px-4 py-2.5 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Google Drive</h2>
        <p className="mt-1 text-sm text-slate-500">
          Conectá tu cuenta para que tus transcripciones se mantengan sincronizadas con Drive
          automáticamente.
        </p>

        <div className="mt-4">
          {connection ? (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Google Drive conectado ✓
            </p>
          ) : (
            <a
              href="/api/drive/connect"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Conectar Google Drive
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
