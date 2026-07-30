import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TRANSCRIPTION_SETTINGS, getUserSettings } from "@/lib/settings/user-settings";
import { LocalRecordingsPanel } from "@/components/app/local-recordings-panel";

/**
 * Biblioteca de grabaciones de ESTE dispositivo (ver `src/lib/recordings/`).
 *
 * Todo lo que se graba en la web se escribe acá antes de intentar subirse, así que esta pantalla
 * es la respuesta a "¿dónde quedó mi audio?" cuando la transcripción falla, no entra por el límite
 * de la web, o el teléfono se quedó sin señal. Los datos son 100% locales: el servidor no sabe
 * nada de esta lista, por eso la página no consulta Supabase más allá de los defaults del usuario.
 */
export default async function GrabacionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const defaults = user ? await getUserSettings(supabase, user.id) : DEFAULT_TRANSCRIPTION_SETTINGS;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/app"
          className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
        >
          ← Volver
        </Link>
      </div>

      <h1 className="text-xl font-bold text-foreground">Grabaciones de este dispositivo</h1>
      <p className="mt-1 mb-6 text-sm text-tertiary">
        Todo lo que grabás desde la web queda guardado acá, en este teléfono o computadora, incluso si
        después falla la subida. Se borra solo cuando vos lo borrás.
      </p>

      <LocalRecordingsPanel defaults={defaults} />

      <p className="mt-8 text-sm text-tertiary">
        ¿No ves ninguna? Es porque esta lista es de este dispositivo y este navegador: las grabaciones
        hechas en otro teléfono no aparecen acá. Tus transcripciones ya subidas están en{" "}
        <Link href="/app" className="font-semibold text-accent hover:underline">
          el dashboard
        </Link>
        .
      </p>
    </div>
  );
}
