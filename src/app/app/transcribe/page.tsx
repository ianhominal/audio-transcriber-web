import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/settings/user-settings";
import { listVocabularyTerms } from "@/lib/vocabulary/store";
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
  // `hasVocabulary` (vocabulario custom, ver ROADMAP.md) se resuelve igual: solo sirve para decidir
  // si mostrar el toggle "Corregir con tu vocabulario" — no hace falta la lista completa acá, solo
  // saber si hay al menos un término cargado.
  const [transcriptionDefaults, vocabularyTerms] = user
    ? await Promise.all([getUserSettings(supabase, user.id), listVocabularyTerms(supabase, user.id)])
    : [null, []];

  return (
    <TranscribeWorkspace
      projects={list}
      initialProject={initialProject}
      initialDefaults={transcriptionDefaults ?? undefined}
      hasVocabulary={vocabularyTerms.length > 0}
    />
  );
}
