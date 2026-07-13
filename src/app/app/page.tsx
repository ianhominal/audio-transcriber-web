import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeTagFilter } from "@/lib/tags";
import { RESURFACE_MIN_AGE_DAYS } from "@/lib/resurface";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildProjectBreadcrumb, buildProjectTree, getSubfolders, rollUpProjectCounts } from "@/lib/drive/tree";
import {
  getProjectColorCompatSnapshot,
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markProjectColorCompatResult,
  markSchemaCompatResult,
  shouldRedetectProjectColorCompat,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";
import { DashboardShell } from "./dashboard-shell";
import { NewProjectButton } from "./new-project-button";
import { NewSubfolderButton } from "./new-subfolder-button";
import { ProjectHeader } from "./project-header";
import { ProjectTree } from "./project-tree";
import { ResurfaceCard } from "./resurface-card";
import { SubfolderCard } from "./subfolder-card";
import { TranscriptionRow } from "./transcription-row";
import { UnassignedProjectLink } from "./unassigned-drop-link";

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  text: string;
  icon: string;
  created_at: string;
  project_id: string | null;
  // Tags de tema (tanda 3 de quick wins, ver ROADMAP.md) — siempre un array (nunca
  // undefined/null: `fetchTranscriptionsCompat` degrada a `[]` durante la ventana de rollout).
  tags: string[];
};

type Project = {
  id: string;
  name: string;
  icon: string;
  description: string;
  created_at: string;
  parent_project_id: string | null;
  sync_origin: string;
  color: string | null;
};

const BASE_PROJECT_COLUMNS = "id, name, icon, description, created_at";
const DRIVE_SYNC_V2_COLUMNS = "parent_project_id, sync_origin";
const COLOR_COLUMN = "color";

/**
 * Columnas OPCIONALES de `projects` (agregadas por migraciones que se aplican automático recién
 * al mergear a `main`, no corren solas — ver `src/lib/supabase/schema-compat.ts`): Drive-sync v2
 * (`parent_project_id`/`sync_origin`, doc 10) y F2 (`color`). Son dos migraciones INDEPENDIENTES
 * que pueden estar aplicadas o no por separado, así que se pelan de a una — más nueva primero
 * (`color`) — en vez de asumir que si una falta, faltan las dos. Si el select completo devuelve
 * `42703`, ANTES este código quedaba con `projectsData` vacío (dashboard sin proyectos); ahora
 * cae en cascada a versiones reducidas. `description`/`created_at` existen desde el esquema
 * inicial (no son parte de ninguna de esas migraciones), así que se piden siempre.
 */
async function fetchProjectsCompat(supabase: SupabaseClient): Promise<Project[]> {
  const now = Date.now();
  const runQuery = (columns: string) =>
    supabase.from("projects").select(columns).is("deleted_at", null).order("created_at", { ascending: true });

  const driveCached = getSchemaCompatSnapshot();
  const colorCached = getProjectColorCompatSnapshot();
  const driveKnownUnavailable = driveCached.available === false && !shouldRedetectSchemaCompat(now);
  const colorKnownUnavailable = colorCached.available === false && !shouldRedetectProjectColorCompat(now);

  const driveColumns = driveKnownUnavailable ? "" : `, ${DRIVE_SYNC_V2_COLUMNS}`;
  const colorColumns = colorKnownUnavailable ? "" : `, ${COLOR_COLUMN}`;

  const { data, error } = await runQuery(BASE_PROJECT_COLUMNS + driveColumns + colorColumns);
  if (!error) {
    if (!driveKnownUnavailable) markSchemaCompatResult(true, now);
    if (!colorKnownUnavailable) markProjectColorCompatResult(true, now);
    return normalizeProjectRows(data, !driveKnownUnavailable, !colorKnownUnavailable);
  }
  if (!isMissingColumnError(error)) return [];

  // Pela `color` primero (la migración más nueva) y reintenta, antes de asumir que Drive-sync v2
  // también falta — evita marcarlo como no disponible por un falso positivo cuando esa migración
  // ya está aplicada y lo único que falta es `color`.
  if (!colorKnownUnavailable) {
    const retry = await runQuery(BASE_PROJECT_COLUMNS + driveColumns);
    if (!retry.error) {
      // Recién acá confirmamos que sacar `color` resolvió el `42703` original — si se marcara
      // ANTES de este punto y este retry también fallara (por Drive-sync v2 faltante) y cayera
      // al fallback final de columnas base, `color` quedaría cacheado como no disponible por todo
      // el TTL aunque en realidad esté presente en la base.
      markProjectColorCompatResult(false, now);
      if (!driveKnownUnavailable) markSchemaCompatResult(true, now);
      return normalizeProjectRows(retry.data, !driveKnownUnavailable, false);
    }
    if (!isMissingColumnError(retry.error)) return [];
  }

  if (!driveKnownUnavailable) markSchemaCompatResult(false, now);
  const finalRetry = await runQuery(BASE_PROJECT_COLUMNS);
  return normalizeProjectRows(finalRetry.data, false, false);
}

function normalizeProjectRows(rows: unknown, driveAvailable: boolean, colorAvailable: boolean): Project[] {
  return (
    (rows ?? []) as { id: string; name: string; icon: string; description: string; created_at: string }[]
  ).map((p) => {
    const raw = p as unknown as {
      id: string;
      name: string;
      icon: string;
      description: string;
      created_at: string;
      parent_project_id?: string | null;
      sync_origin?: string;
      color?: string | null;
    };
    return {
      id: raw.id,
      name: raw.name,
      icon: raw.icon,
      description: raw.description,
      created_at: raw.created_at,
      parent_project_id: driveAvailable ? (raw.parent_project_id ?? null) : null,
      sync_origin: driveAvailable ? (raw.sync_origin ?? "local") : "local",
      color: colorAvailable ? (raw.color ?? null) : null,
    };
  });
}

const BASE_TRANSCRIPTION_COLUMNS = "id, title, audio_name, text, icon, created_at, project_id";

/**
 * Trae la lista de transcripciones del nivel actual (proyecto/carpeta o "Todas"/"Sin proyecto"), con
 * soporte opcional de filtro por tag (`?tag=`, tanda 3 de quick wins — ver `normalizeTagFilter` en
 * `src/lib/tags.ts`). `tags` (`supabase/migrations/20260711160000_transcription_tags.sql`) es la
 * columna MÁS NUEVA de esta query — mismo criterio de compat que `fetchProjectsCompat`: si todavía
 * no existe (`42703`, ventana de rollout), se degrada a `tags: []` en cada fila y el filtro por tag
 * queda inerte (no hay nada contra qué filtrar) en vez de romper el dashboard entero.
 *
 * Scoping por usuario: lo resuelve RLS (policy "own transcriptions", mismo criterio que el resto de
 * las queries de `transcriptions` en esta app, ver `/api/summarize`) — el filtro por tag se aplica
 * DENTRO de esa misma query ya scopeada al dueño, nunca se abre una consulta sin RLS para esto (sin
 * eso, un tag ajeno nunca podría filtrar notas de otro usuario, pero tampoco hace falta un chequeo
 * manual: RLS ya lo garantiza a nivel de fila).
 */
async function fetchTranscriptionsCompat(
  supabase: SupabaseClient,
  filter: string | undefined,
  tagFilter: string | null
): Promise<Transcription[]> {
  const runQuery = (columns: string, applyTagFilter: boolean) => {
    let q = supabase
      .from("transcriptions")
      .select(columns)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter === "none") q = q.is("project_id", null);
    else if (filter) q = q.eq("project_id", filter);
    if (applyTagFilter && tagFilter) q = q.contains("tags", [tagFilter]);
    return q;
  };

  // `columns` es un parámetro (`string` genérico, no un literal) — igual que `runQuery` en
  // `fetchProjectsCompat`, el cliente tipado de Supabase no puede resolver el shape en tiempo de
  // compilación a partir de un string dinámico y devuelve `GenericStringError`. Se castea vía
  // `unknown` (mismo escape hatch que `normalizeProjectRows`, ahí a través de un parámetro
  // `rows: unknown` separado) — la forma REAL la garantiza `columns`, elegido a mano en este mismo
  // archivo, no input externo.
  const { data, error } = await runQuery(`${BASE_TRANSCRIPTION_COLUMNS}, tags`, true);
  if (!error) return (data ?? []) as unknown as Transcription[];
  if (!isMissingColumnError(error)) return [];

  const fallback = await runQuery(BASE_TRANSCRIPTION_COLUMNS, false);
  return ((fallback.data ?? []) as unknown as Omit<Transcription, "tags">[]).map((t) => ({ ...t, tags: [] }));
}

type ResurfaceCandidateRow = { id: string; title: string; text: string; audio_name: string; created_at: string };

/**
 * Candidatas a "resurfacing" (quick win del brainstorm, ver ROADMAP.md — "Mantener vivo el
 * archivo"): notas propias (RLS), no borradas, con al menos `RESURFACE_MIN_AGE_DAYS` de
 * antigüedad. Se traen hasta `RESURFACE_CANDIDATE_LIMIT` (ordenadas por las más viejas primero) en
 * vez de una sola fila para que la selección FINAL pueda vivir en el cliente
 * (`pickResurfaceCandidate`, ver `resurface-card.tsx`) — el server no sabe qué notas ya se
 * descartaron en este dispositivo (`localStorage`), así que le pasa un lote chico y el cliente
 * elige. Ante cualquier error de la query, degrada a `[]` (sin card) — es un widget de
 * descubrimiento, nunca debe poder romper el dashboard.
 */
async function fetchResurfaceCandidates(supabase: SupabaseClient): Promise<ResurfaceCandidateRow[]> {
  const RESURFACE_CANDIDATE_LIMIT = 10;
  const cutoff = new Date(Date.now() - RESURFACE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("transcriptions")
    .select("id, title, text, audio_name, created_at")
    .is("deleted_at", null)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(RESURFACE_CANDIDATE_LIMIT);
  if (error) return [];
  return (data ?? []) as unknown as ResurfaceCandidateRow[];
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tag?: string }>;
}) {
  const { project: filter, tag: tagParam } = await searchParams;
  const tagFilter = normalizeTagFilter(tagParam);
  const supabase = await createClient();

  // Resurfacing solo tiene sentido en la vista "de entrada" del dashboard ("Todas"/"Sin proyecto"),
  // no navegando dentro de un proyecto/carpeta puntual — mismo criterio de "sutil, no invasivo"
  // del pedido: no compite por atención con el contenido de una carpeta que la usuaria ya eligió
  // activamente. Tampoco con un filtro por tag activo (hallazgo LOW del review adversarial): la
  // candidata de resurfacing no respeta ESE tag, así que mostrarla junto a un "no hay nada acá"
  // del filtro sería confuso — sugiere una nota que no tiene nada que ver con lo que se está
  // filtrando. Se evalúa ANTES del fetch de proyectos (no depende de `activeProject`, calculado
  // más abajo) para poder saltear la query por completo fuera de esta vista.
  const isTopView = (!filter || filter === "none") && !tagFilter;

  const [projects, { data: countRows }, items, resurfaceCandidates] = await Promise.all([
    fetchProjectsCompat(supabase),
    supabase.from("transcriptions").select("project_id").is("deleted_at", null),
    fetchTranscriptionsCompat(supabase, filter, tagFilter),
    isTopView ? fetchResurfaceCandidates(supabase) : Promise.resolve([]),
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
    color: p.color,
  }));
  const projectTree = buildProjectTree(projectsFull);
  const countsByProjectId = rollUpProjectCounts(projectTree, Object.fromEntries(counts)); // Map no es serializable al pasarlo a un Client Component

  // Lista filtrada: transcripciones DIRECTAS de este nivel (ni recursivo hacia subcarpetas, ni
  // hacia arriba), con filtro por tag opcional — `items` ya se resolvió arriba, en el mismo
  // `Promise.all` (`fetchTranscriptionsCompat`).
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
      {/* Sidebar de proyectos: en desktop queda fija en el grid (sin cambios); en mobile se
          convierte en un drawer off-canvas — ver `DashboardShell` (`dashboard-shell.tsx`). */}
      <DashboardShell
        sidebar={
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
              <p className="mb-2 px-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wide text-tertiary">
                Proyectos
              </p>
              {/* El `max-h`/`overflow-y-auto` solo tiene sentido en desktop, donde el sidebar es
                  `sticky` y necesita un tope para no desbordar el viewport. En el drawer mobile ya
                  scrollea el panel completo (`DashboardShell`) — un segundo scroll anidado ahí
                  sería justo la mala UX que este cambio busca sacar. */}
              <nav className="min-h-[10rem] space-y-0.5 md:max-h-[65vh] md:overflow-y-auto md:pr-0.5">
                <SidebarLink href="/app" active={!filter} label="Todas" count={total} icon="🗂️" />
                <ProjectTree
                  projects={projectsFull}
                  counts={countsByProjectId}
                  activeProjectId={filter && filter !== "none" ? filter : null}
                />
                <UnassignedProjectLink active={filter === "none"} count={noneCount} />
              </nav>
            </div>
            <NewProjectButton />
          </div>
        }
      />

      {/* Panel principal: explorador jerárquico (proyecto/carpeta seleccionado) o lista plana
          ("Todas" / "Sin proyecto", comportamiento sin cambios). */}
      <main className="min-w-0">
        {/* Filtro por tag activo (tanda 3 de quick wins, ver ROADMAP.md) — se combina con el
            proyecto/carpeta actual si hay uno (la query de `items` ya aplica ambos), "Quitar
            filtro" vuelve a la misma vista de proyecto pero sin el tag. */}
        {tagFilter && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm">
            <span className="text-secondary">
              Filtrando por etiqueta: <span className="font-semibold text-foreground">{tagFilter}</span>
            </span>
            <Link
              href={filter ? `/app?project=${filter}` : "/app"}
              className="ml-auto text-xs font-semibold text-accent hover:underline"
            >
              Quitar filtro
            </Link>
          </div>
        )}
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
                color: activeProject.color,
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
            <ResurfaceCard candidates={resurfaceCandidates} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{heading}</h1>
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
    <nav aria-label="Ruta de carpetas" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-tertiary">
      <Link href="/app" className="transition hover:text-accent">
        🗂️ Todas
      </Link>
      {chain.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          <span className="text-tertiary">/</span>
          {i === chain.length - 1 ? (
            <span className="font-medium text-secondary">
              {p.icon || "📁"} {p.name}
            </span>
          ) : (
            <Link href={`/app?project=${p.id}`} className="transition hover:text-accent">
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
        active ? "bg-accent-subtle font-semibold text-accent-subtle-text" : "text-secondary hover:bg-surface-secondary"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-tertiary">{count}</span>
    </Link>
  );
}
