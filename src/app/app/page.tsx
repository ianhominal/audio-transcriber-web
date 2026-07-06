import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { NewProjectButton } from "./new-project-button";

type Transcription = {
  id: string;
  audio_name: string;
  text: string;
  created_at: string;
  project_id: string | null;
};

type Project = { id: string; name: string; icon: string };

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: filter } = await searchParams;
  const supabase = await createClient();

  const [{ data: projectsData }, { data: countRows }] = await Promise.all([
    supabase.from("projects").select("id, name, icon").order("created_at", { ascending: true }),
    supabase.from("transcriptions").select("project_id"),
  ]);

  const projects = (projectsData ?? []) as Project[];

  // Conteos por proyecto + "sin proyecto" + total.
  const counts = new Map<string, number>();
  let noneCount = 0;
  for (const row of (countRows ?? []) as { project_id: string | null }[]) {
    if (row.project_id) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
    else noneCount++;
  }
  const total = (countRows ?? []).length;

  // Lista filtrada.
  let query = supabase
    .from("transcriptions")
    .select("id, audio_name, text, created_at, project_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "none") query = query.is("project_id", null);
  else if (filter) query = query.eq("project_id", filter);
  const { data: listData } = await query;
  const items = (listData ?? []) as Transcription[];

  const activeProject = filter && filter !== "none" ? projects.find((p) => p.id === filter) : null;
  const heading =
    filter === "none" ? "Sin proyecto" : activeProject ? activeProject.name : "Todas las transcripciones";

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 md:grid-cols-[15rem_1fr]">
      {/* Sidebar de proyectos */}
      <aside className="space-y-4">
        <div>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Proyectos
          </p>
          <nav className="space-y-0.5">
            <SidebarLink href="/app" active={!filter} label="Todas" count={total} icon="🗂️" />
            {projects.map((p) => (
              <SidebarLink
                key={p.id}
                href={`/app?project=${p.id}`}
                active={filter === p.id}
                label={p.name}
                count={counts.get(p.id) ?? 0}
                icon={p.icon || "📁"}
              />
            ))}
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
      <main>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
          <Link
            href="/app/transcribe"
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700"
          >
            + Nueva transcripción
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="font-medium text-slate-700">Nada por acá todavía</p>
            <p className="mt-1 text-sm text-slate-500">
              Subí un audio y tu transcripción va a aparecer en esta lista.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/t/${t.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-semibold text-slate-800">{t.audio_name}</p>
                    <span className="shrink-0 text-xs text-slate-400">{formatDate(t.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {t.text || "(sin texto)"}
                  </p>
                </Link>
              </li>
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
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
        active ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-slate-400">{count}</span>
    </Link>
  );
}
