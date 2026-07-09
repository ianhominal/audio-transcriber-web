import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/settings/user-settings";
import { TranscribeWorkspace } from "./transcribe-workspace";

export default async function TranscribePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  const supabase = await createClient();

  // `projects` y el usuario autenticado son independientes entre sí — se piden en paralelo (en
  // vez de encadenados) para no pagar la suma de ambas latencias en cada carga de esta pantalla.
  const [{ data: projects }, {
    data: { user },
  }] = await Promise.all([
    supabase.from("projects").select("id, name, icon").is("deleted_at", null).order("created_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  // Solo preseleccionamos si el proyecto existe realmente.
  const list = projects ?? [];
  const initialProject = project && list.some((p) => p.id === project) ? project : "";

  // Defaults persistentes (Motor/Calidad/Idioma, ver ROADMAP.md ítem F1) resueltos server-side:
  // el workspace arranca ya con el valor real de Supabase, sin flicker ni revalidación extra.
  const transcriptionDefaults = user ? await getUserSettings(supabase, user.id) : null;

  return (
    <TranscribeWorkspace
      projects={list}
      initialProject={initialProject}
      initialDefaults={transcriptionDefaults ?? undefined}
    />
  );
}
