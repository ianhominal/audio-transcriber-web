import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildProjectBreadcrumb, buildProjectTree, getSubfolders, rollUpProjectCounts } from "@/lib/drive/tree";
import {
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markSchemaCompatResult,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";
import { NewProjectButton } from "./new-project-button";
import { NewSubfolderButton } from "./new-subfolder-button";
import { ProjectHeader } from "./project-header";
import { ProjectTree } from "./project-tree";
import { SubfolderCard } from "./subfolder-card";
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

type Project = {
  id: string;
  name: string;
  icon: string;
  description: string;
  created_at: string;
  parent_project_id: string | null;
  sync_origin: string;
};

/**
 * Columnas de Drive-sync v2 (doc 10) en `projects`: si la migración `20260707130000_
 * drive_sync_v2_foundation.sql` todavía no se corrió a mano en producción, el select completo
 * devuelve `42703` y ANTES este código quedaba con `projectsData` vacío (dashboard sin
 * proyectos). Ahora cae a la versión reducida y completa los campos por defecto — ver
 * `src/lib/supabase/schema-compat.ts`. `description`/`created_at` existen desde el esquema
 * inicial (no son parte de esa migración), así que se piden siempre en ambos caminos.
 */
async function fetchProjectsCompat(supabase: SupabaseClient): Promise<Project[]> {
  const now = Date.now();
  const runQuery = (columns: string) =>
    supabase.from("projects").select(columns).is("deleted_at", null).order("created_at", { ascending: true });

  const cached = getSchemaCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectSchemaCompat(now);

  if (useReducedDirectly) {
    const { data } = await runQuery("id, name, icon, description, created_at");
    return withDefaultDriveSyncFields(data);
  }

  const { data, error } = await runQuery("id, name, icon, description, created_at, parent_project_id, sync_origin");
  if (!error) {
    markSchemaCompatResult(true, now);
    return (data ?? []) as unknown as Project[];
  }

  if (isMissingColumnError(error)) {
    markSchemaCompatResult(false, now);
    const retry = await runQuery("id, name, icon, description, created_at");
    return withDefaultDriveSyncFields(retry.data);
  }

  return [];
}

function withDefaultDriveSyncFields(rows: unknown): Project[] {
  return (
    (rows ?? []) as { id: string; name: string; icon: string; description: string; created_at: string }[]
  ).map((p) => ({
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

  // Lista de proyectos con campos en camelCase (jerarquía Drive-sync v2) armada UNA vez acá:
  // sirve para <ProjectTree> (sidebar), para el roll-up de conteos (`rollUpProjectCounts`, un
  // proyecto padre muestra el total INCLUYENDO a sus descendientes) y para el EXPLORADOR
  // jerárquico del panel principal (subcarpetas de la carpeta activa + breadcrumb), con
  // `getSubfolders`/`buildProjectBreadcrumb` — todo PURO, en src/lib/drive/tree.ts.
  const projectsFull = projects.map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    description: p.description,
    createdAt: p.created_at,
    parentProjectId: p.parent_project_id,
    syncOrigin: p.sync_origin,
  }));
  const projectTree = buildProjectTree(projectsFull);
  const countsByProjectId = rollUpProjectCounts(projectTree, Object.fromEntries(counts)); // Map no es serializable al pasarlo a un Client Component

  // Lista filtrada: transcripciones DIRECTAS de este nivel (ni recursivo hacia subcarpetas, ni
  // hacia arriba) — mismo criterio que ya usaba esta query antes del explorador, y es justo lo
  // que necesita el panel "estilo Windows" (archivos de la carpeta actual, no de sus hijas).
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

  const activeProject = filter && filter !== "none" ? projectsFull.find((p) => p.id === filter) : null;
  const heading =
    filter === "none" ? "Sin proyecto" : activeProject ? activeProject.name : "Todas las transcripciones";

  // Al crear desde un proyecto, arrastramos ese proyecto como destino.
  const newHref = activeProject ? `/app/transcribe?project=${activeProject.id}` : "/app/transcribe";

  // Explorador jerárquico (solo tiene sentido con un proyecto/carpeta puntual seleccionado, no en
  // "Todas" ni en "Sin proyecto"): subcarpetas DIRECTAS + breadcrumb raíz→actual.
  const subfolders = activeProject ? getSubfolders(activeProject.id, projectsFull) : [];
  const breadcrumbChain = activeProject ? buildProjectBreadcrumb(activeProject.id, projectsFull) : [];
  // Disponibilidad real de la migración de jerarquía (detectada recién por `fetchProjectsCompat`
  // más arriba): si no está aplicada, deshabilitamos "Nueva carpeta" con un mensaje claro en vez
  // de dejar que el usuario choque con el error al enviar el formulario.
  const subfoldersAvailable = getSchemaCompatSnapshot().available === true;

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
              projects={projectsFull}
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

      {/* Panel principal: explorador jerárquico (proyecto/carpeta seleccionado) o lista plana
          ("Todas" / "Sin proyecto", comportamiento sin cambios). */}
      <main className="min-w-0">
        {activeProject ? (
          <>
            <Breadcrumb chain={breadcrumbChain} />
            <ProjectHeader
              project={{
                id: activeProject.id,
                name: activeProject.name,
                icon: activeProject.icon,
                description: activeProject.description,
                createdAt: activeProject.createdAt,
                syncOrigin: activeProject.syncOrigin,
              }}
              subfolderCount={subfolders.length}
              transcriptionCount={items.length}
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <NewSubfolderButton parentId={activeProject.id} available={subfoldersAvailable} />
              <Link href={newHref} className={buttonClasses({ size: "sm" })}>
                🎙️ Nueva transcripción
              </Link>
            </div>

            {subfolders.length === 0 && items.length === 0 ? (
              <EmptyState
                className="mt-4"
                icon="📂"
                title="Esta carpeta está vacía"
                description="Creá una subcarpeta para organizarla mejor, o agregá tu primera transcripción acá."
                action={
                  <>
                    <NewSubfolderButton parentId={activeProject.id} available={subfoldersAvailable} />
                    <Link href={newHref} className={buttonClasses({ size: "sm" })}>
                      🎙️ Nueva transcripción
                    </Link>
                  </>
                }
              />
            ) : (
              <div className="mt-4 space-y-5">
                {/* Carpetas primero, estilo explorador de archivos. */}
                {subfolders.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {subfolders.map((sf) => (
                      <SubfolderCard
                        key={sf.id}
                        folder={sf}
                        subfolderCount={getSubfolders(sf.id, projectsFull).length}
                        transcriptionCount={counts.get(sf.id) ?? 0}
                      />
                    ))}
                  </div>
                )}

                {/* Después, las transcripciones ("archivos") de este mismo nivel. */}
                {items.length > 0 && (
                  <ul className="space-y-3">
                    {items.map((t) => (
                      <TranscriptionRow key={t.id} transcription={t} projects={projects} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}

/** Breadcrumb de navegación del explorador: raíz ("Todas") → ... → carpeta actual. Clickeable
 * para volver a cualquier nivel (misma navegación por `?project=<id>` que usa el resto de la
 * app). */
function Breadcrumb({ chain }: { chain: { id: string; name: string; icon: string }[] }) {
  return (
    <nav aria-label="Ruta de carpetas" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500">
      <Link href="/app" className="transition hover:text-brand-600">
        🗂️ Todas
      </Link>
      {chain.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          <span className="text-slate-300">/</span>
          {i === chain.length - 1 ? (
            <span className="font-medium text-slate-700">
              {p.icon || "📁"} {p.name}
            </span>
          ) : (
            <Link href={`/app?project=${p.id}`} className="transition hover:text-brand-600">
              {p.icon || "📁"} {p.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
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
