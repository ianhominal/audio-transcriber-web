import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET } from "@/lib/storage";
import { TranscriptionDetail } from "./transcription-detail";

export default async function TranscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: t }, { data: projectsData }] = await Promise.all([
    supabase
      .from("transcriptions")
      .select(
        "id, title, audio_name, audio_size, audio_url, text, description, icon, language, model, project_id, created_at"
      )
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("projects")
      .select("id, name, icon")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  if (!t) notFound();

  // URL firmada temporal para el reproductor (el bucket es privado).
  let audioSrc: string | null = null;
  if (t.audio_url) {
    const { data: signed } = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(t.audio_url, 60 * 60);
    audioSrc = signed?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/app" className="text-sm text-slate-500 hover:text-indigo-600">
        ← Volver
      </Link>
      <TranscriptionDetail transcription={t} projects={projectsData ?? []} audioSrc={audioSrc} />
    </div>
  );
}
