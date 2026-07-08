import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildProjectTree, rollUpProjectCounts } from "@/lib/drive/tree";
import {
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markSchemaCompatResult,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";
import { NewProjectButton } from "./new-project-button";
import { ProjectTree } from "./project-tree";
import { TranscriptionRow } from "./transcription-row";

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  text: string;
  icon: string;
  created_at: string;
  project_id: string | null;
};

type Project = { id: string; name: string; icon: string; parent_project_id: string | null; sync_origin: string };

/**
 * Columnas de Drive-sync v2 (doc 10) en `projects`: si la migración `20260707130000_
 * drive_sync_v2_foundation.sql` todavía no se corrió a mano en producción, el select completo
 * devuelve `42703` y ANTES este código quedaba con `projectsData` vacío (dashboard sin
 * proyectos). Ahora cae a la versión reducida y completa los campos por defecto — ver
 * `src/lib/supabase/schema-compat.ts`.
 */
async function fetchProjectsCompat(supabase: SupabaseClient): Promise<Project[]> {
  const now = Date.now();
  const runQuery = (columns: string) =>
    supabase.from("projects").select(columns).is("deleted_at", null).order("created_at", { ascending: true });

  const cached = getSchemaCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectSchemaCompat(now);

  if (useReducedDirectly) {
    const { data } = await runQuery("id, name, icon");
    return withDefaultDriveSyncFields(data);
  }

  const { data, error } = await runQuery("id, name, icon, parent_project_id, sync_origin");
  if (!error) {
    markSchemaCompatResult(true, now);
    return (data ?? []) as unknown as Project[];
  }

  if (isMissingColumnError(error)) {
    markSchemaCompatResult(false, now);
    const retry = await runQuery("id, name, icon");
    return withDefaultDriveSyncFields(retry.data);
  }

  return [];
}

function withDefaultDriveSyncFields(rows: unknown): Project[] {
  return ((rows ?? []) as { id: string; name: string; icon: string }[]).map((p) => ({
    ...p,
    parent_project_id: null,
    sync_origin: "local",
  }));
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: filter } = await searchParams;
  const supabase = await createClient();

  const [projects, { data: countRows }] = await Promise.all([
    fetchProjectsCompat(supabase),
    supabase.from("transcriptions").select("project_id").is("deleted_at", null),
  ]);

  // Conteos por proyecto + "sin proyecto" + total.
  const counts = new Map<string, number>();
  let noneCount = 0;
  for (const row of (countRows ?? []) as { project_id: string | null }[]) {
    if (row.project_id) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
    else noneCount++;
  }
  const total = (countRows ?? []).length;

  // Árbol de proyectos (jerarquía Drive-sync v2) armado UNA vez acá: sirve tanto para pasarle la
  // lista plana a <ProjectTree> (que lo re-arma client-side, barato) como para el roll-up de
  // conteos — un proyecto padre muestra el total INCLUYENDO a sus descendientes, no solo el
  // propio (`rollUpProjectCounts`, puro, en src/lib/drive/tree.ts).
  const projectTreeInput = projects.map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    parentProjectId: p.parent_project_id,
    syncOrigin: p.sync_origin,
  }));
  const projectTree = buildProjectTree(projectTreeInput);
  const countsByProjectId = rollUpProjectCounts(projectTree, Object.fromEntries(counts)); // Map no es serializable al pasarlo a un Client Component

  // Lista filtrada.
  let query = supabase
    .from("transcriptions")
    .select("id, title, audio_name, text, icon, created_at, project_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "none") query = query.is("project_id", null);
  else if (filter) query = query.eq("project_id", filter);
  const { data: listData } = await query;
  const items = (listData ?? []) as Transcription[];

  const activeProject = filter && filter !== "none" ? projects.find((p) => p.id === filter) : null;
  const heading =
    filter === "none" ? "Sin proyecto" : activeProject ? activeProject.name : "Todas las transcripciones";

  // Al crear desde un proyecto, arrastramos ese proyecto como destino.
  const newHref = activeProject ? `/app/transcribe?project=${activeProject.id}` : "/app/transcribe";

  return (
    <div className="mx-auto max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-8 md:grid md:grid-cols-[16rem_1fr] md:items-start">
      {/* Sidebar de proyectos */}
      <aside className="mb-6 space-y-3 md:sticky md:top-20 md:mb-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 px-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Proyectos
          </p>
          <nav className="max-h-[65vh] space-y-0.5 overflow-y-auto pr-0.5">
            <SidebarLink href="/app" active={!filter} label="Todas" count={total} icon="🗂️" />
            <ProjectTree
              projects={projectTreeInput}
              counts={countsByProjectId}
              activeProjectId={filter && filter !== "none" ? filter : null}
            />
            <SidebarLink
              href="/app?project=none"
              active={filter === "none"}
              label="Sin proyecto"
              count={noneCount}
              icon="📄"
            />
          </nav>
        </div>
        <NewProjectButton />
      </aside>

      {/* Lista principal */}
      <main className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{heading}</h1>
          <Link href={newHref} className={buttonClasses({ size: "md" })}>
            + Nueva transcripción
          </Link>
        </div>

        {items.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon="🎙️"
            title="Todavía no hay transcripciones acá"
            description="Grabá tu voz, capturá una reunión o subí un audio y va a aparecer en esta lista."
            action={
              <>
                <Link href={newHref} className={buttonClasses({ size: "sm" })}>
                  🎙️ Grabar
                </Link>
                <Link href={newHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  📤 Subir audio
                </Link>
              </>
            }
          />
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((t) => (
              <TranscriptionRow key={t.id} transcription={t} projects={projects} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function SidebarLink({
  href,
  active,
  label,
  count,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
        active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-slate-400">{count}</span>
    </Link>
  );
}
