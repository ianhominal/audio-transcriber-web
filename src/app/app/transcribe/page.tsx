import { createClient } from "@/lib/supabase/server";
import { TranscribeWorkspace } from "./transcribe-workspace";

export default async function TranscribePage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, icon")
    .order("created_at", { ascending: true });

  return <TranscribeWorkspace projects={projects ?? []} />;
}
