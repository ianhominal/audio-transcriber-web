import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TRANSCRIPTION_SETTINGS, getUserSettings } from "@/lib/settings/user-settings";
import { CaptureWorkspace } from "./capture-workspace";

/**
 * Captura sin fricción: arranca a grabar apenas carga, sin selector de proyecto ni pasos previos
 * (ver brainstorm "Captura sin fricción"). Es el destino del shortcut de la PWA ("Grabar", ver
 * `manifest.ts`) — mantener apretado el ícono de la app en el celular salta directo acá.
 *
 * Sin selector de "Proyecto destino" a propósito: la grabación se transcribe sin `projectId` (cae
 * en "Sin proyecto", igual que dejar el selector de `TranscribeWorkspace` en su valor por
 * defecto) — la usuaria puede moverla a un proyecto después desde el dashboard. Esto ya cubre la
 * necesidad de un "inbox" sin agregar UI/estado nuevo (ver alcance del cambio).
 */
export default async function CapturarPage({
  searchParams,
}: {
  searchParams: Promise<{ shareError?: string }>;
}) {
  const { shareError } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const defaults = user ? await getUserSettings(supabase, user.id) : DEFAULT_TRANSCRIPTION_SETTINGS;

  return <CaptureWorkspace defaults={defaults} initialError={shareError} />;
}
