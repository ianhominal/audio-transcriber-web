import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET } from "@/lib/storage";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { TranscriptionDetail } from "./transcription-detail";

const BASE_COLUMNS =
  "id, title, audio_name, audio_size, audio_url, text, description, icon, language, model, project_id, created_at";
// `translated_to`/`original_text` (Fase F4, ver supabase/migrations/20260709210000_translation.sql)
// se aplican automático recién al mergear a `main` (mismo criterio que `projects.color` en F2) —
// pueden no existir todavía en el preview de esta branch. Se intenta con las columnas nuevas
// primero y, ante un 42703, se reintenta con `BASE_COLUMNS` (ver más abajo).
const COLUMNS_WITH_TRANSLATION = `${BASE_COLUMNS}, translated_to, original_text`;

export default async function TranscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [transcriptionResult, { data: projectsData }] = await Promise.all([
    supabase
      .from("transcriptions")
      .select(COLUMNS_WITH_TRANSLATION)
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("projects")
      .select("id, name, icon")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  let t = transcriptionResult.data;
  if (!t && isMissingColumnError(transcriptionResult.error)) {
    const fallback = await supabase.from("transcriptions").select(BASE_COLUMNS).eq("id", id).is("deleted_at", null).single();
    t = fallback.data ? { ...fallback.data, translated_to: null, original_text: null } : null;
  }

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
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/app" className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent">
        ← Volver
      </Link>
      <TranscriptionDetail transcription={t} projects={projectsData ?? []} audioSrc={audioSrc} />
    </div>
  );
}
