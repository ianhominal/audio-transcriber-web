import { createClient } from "@/lib/supabase/server";
import { TranscribeWorkspace } from "./transcribe-workspace";

export default async function TranscribePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, icon")
    .order("created_at", { ascending: true });

  // Solo preseleccionamos si el proyecto existe realmente.
  const list = projects ?? [];
  const initialProject = project && list.some((p) => p.id === project) ? project : "";

  return <TranscribeWorkspace projects={list} initialProject={initialProject} />;
}
