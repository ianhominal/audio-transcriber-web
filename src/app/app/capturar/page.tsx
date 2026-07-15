import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TRANSCRIPTION_SETTINGS, getUserSettings } from "@/lib/settings/user-settings";
import { CaptureWorkspace } from "./capture-workspace";

/**
 * Captura sin fricción: un toque y a grabar, sin selector de proyecto ni pasos previos (ver
 * brainstorm "Captura sin fricción"). Es el destino del shortcut de la PWA ("Grabar", ver
 * `manifest.ts`) — mantener apretado el ícono de la app en el celular salta directo acá.
 *
 * `?grabar=1` = INTENCIÓN EXPLÍCITA de grabar (el botón "Grabar" del header, el shortcut de la
 * PWA, el empty-state del dashboard). Solo con ese flag arrancamos el micrófono solos. Sin flag
 * mostramos la pantalla en reposo con un botón grande, porque llegar acá SIN pedirlo pasa de
 * verdad: al volver atrás desde la transcripción el navegador re-monta esta pantalla y, cuando
 * arrancaba a grabar en cada montaje, te empezaba a grabar de nuevo sin que lo pidieras.
 *
 * Sin selector de "Proyecto destino" a propósito: la grabación se transcribe sin `projectId` (cae
 * en "Sin proyecto", igual que dejar el selector de `TranscribeWorkspace` en su valor por
 * defecto) — la usuaria puede moverla a un proyecto después desde el dashboard.
 */
export default async function CapturarPage({
  searchParams,
}: {
  searchParams: Promise<{ shareError?: string; grabar?: string }>;
}) {
  const { shareError, grabar } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const defaults = user ? await getUserSettings(supabase, user.id) : DEFAULT_TRANSCRIPTION_SETTINGS;

  return <CaptureWorkspace defaults={defaults} initialError={shareError} autoStart={grabar === "1"} />;
}
