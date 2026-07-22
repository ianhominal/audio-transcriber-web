import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import { MIN_MERGE_NOTES } from "@/lib/merge/validate";
import { fetchMergeCandidates } from "@/lib/merge/queries";
import { MergeView } from "@/components/app/merge-view";

/**
 * "Merge several notes into one document" (feature 2026-07-13, see brief): per-project page
 * (`?project=<id>`), NOT multi-select — same navigation criteria as the rest of the dashboard
 * (`src/app/app/page.tsx`). Without `project` there's nothing to merge, redirects to `/app`.
 *
 * Ownership: RLS scopes `projects`/`transcriptions` by owner (same criteria as the rest of the app),
 * but it's not blindly trusted — if the project doesn't show up (deleted or belongs to another
 * user), `notFound()`, same criteria as `src/app/app/t/[id]/page.tsx` for a nonexistent/foreign id.
 */
export default async function MergePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectId } = await searchParams;
  if (!projectId) redirect("/app");

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; name: string }>();

  if (!project) notFound();

  // Defense-in-depth ON TOP of RLS (mismo criterio que `/api/notes/merge`/`/api/brain`, ver sus
  // header comments): `user?.id ?? ""` nunca lanza si `user` fuera `null` — un filtro con user_id
  // vacío simplemente no matchea ninguna fila, mismo criterio fail-safe que ya usa esta página para
  // un proyecto inexistente/ajeno (`notFound()` arriba). Query compartida con el dashboard
  // (`src/app/app/page.tsx`, ver `fetchMergeCandidates`) para que ambos entry points de "Combinar en
  // documento" ofrezcan exactamente las mismas notas.
  const { notes, totalNotesInProject } = await fetchMergeCandidates(supabase, projectId, user?.id ?? "");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/app?project=${project.id}`}
        className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
      >
        ← Volver
      </Link>

      {notes.length < MIN_MERGE_NOTES ? (
        <EmptyState
          className="mt-6"
          icon={<Icon name="merge" size={28} />}
          title="Necesitás al menos 2 notas en este proyecto para unirlas en un documento."
          action={
            <Link href={`/app?project=${project.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Volver
            </Link>
          }
        />
      ) : (
        <MergeView
          projectId={project.id}
          projectName={project.name}
          notes={notes}
          totalNotesInProject={totalNotesInProject}
        />
      )}
    </div>
  );
}
