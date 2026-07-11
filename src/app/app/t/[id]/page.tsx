import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET } from "@/lib/storage";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/schema-compat";
import { parseStoredSummary } from "@/lib/summary/format";
import { hashSummarySource } from "@/lib/summary/hash";
import { rowsToUIMessages, type ChatMessageRow } from "@/lib/chat/messages";
import { TranscriptionDetail } from "./transcription-detail";

const BASE_COLUMNS =
  "id, title, audio_name, audio_size, audio_url, text, description, icon, language, model, project_id, created_at";
// `translated_to`/`original_text` (Fase F4, ver supabase/migrations/20260709210000_translation.sql)
// se aplican automático recién al mergear a `main` (mismo criterio que `projects.color` en F2) —
// pueden no existir todavía en el preview de esta branch. Se intenta con las columnas nuevas
// primero y, ante un 42703, se reintenta con `BASE_COLUMNS` (ver más abajo).
const COLUMNS_WITH_TRANSLATION = `${BASE_COLUMNS}, translated_to, original_text`;
// `summary`/`summary_source_hash` (Fase F5, ver supabase/migrations/20260709220000_transcription_summary.sql)
// — mismo criterio de compat que arriba, un nivel de cascada más.
const COLUMNS_WITH_SUMMARY = `${COLUMNS_WITH_TRANSLATION}, summary, summary_source_hash`;
// `vocabulary_corrected` (vocabulario custom, ver supabase/migrations/20260710120000_user_vocabulary.sql)
// — mismo criterio de compat, un nivel de cascada más.
const COLUMNS_WITH_VOCABULARY = `${COLUMNS_WITH_SUMMARY}, vocabulary_corrected`;
// `tags` (tanda 3 de quick wins — auto-título/auto-tags, ver
// supabase/migrations/20260711160000_transcription_tags.sql) — columna MÁS NUEVA, mismo criterio de
// compat, un nivel de cascada más (se pide primero y se pela primero en el fallback de abajo).
const COLUMNS_WITH_TAGS = `${COLUMNS_WITH_VOCABULARY}, tags`;

export default async function TranscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [transcriptionResult, { data: projectsData }, chatMessagesResult] = await Promise.all([
    supabase
      .from("transcriptions")
      .select(COLUMNS_WITH_TAGS)
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("projects")
      .select("id, name, icon")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    // Chat con IA (ver ROADMAP.md): historial cargado server-side, mismo criterio que el resumen —
    // el cliente (`chat-panel.tsx`) recibe el shape final (`UIMessage[]`), no reinterpreta filas de
    // DB. `chat_messages` es tabla NUEVA (migración `20260710140000_chat_messages.sql`): si todavía
    // no está aplicada, degrada a historial vacío (`isMissingTableError`) en vez de romper la
    // página — mismo criterio que `vocabulary_terms`/`ai_usage_log`.
    supabase
      .from("chat_messages")
      .select("id, role, content")
      .eq("transcription_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const initialChatMessages = isMissingTableError(chatMessagesResult.error)
    ? []
    : rowsToUIMessages((chatMessagesResult.data as ChatMessageRow[] | null) ?? []);

  let t = transcriptionResult.data;
  if (!t && isMissingColumnError(transcriptionResult.error)) {
    const withVocabulary = await supabase
      .from("transcriptions")
      .select(COLUMNS_WITH_VOCABULARY)
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (withVocabulary.data) {
      t = { ...withVocabulary.data, tags: [] };
    } else if (isMissingColumnError(withVocabulary.error)) {
      const withSummary = await supabase
        .from("transcriptions")
        .select(COLUMNS_WITH_SUMMARY)
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (withSummary.data) {
        t = { ...withSummary.data, vocabulary_corrected: null, tags: [] };
      } else if (isMissingColumnError(withSummary.error)) {
        const withTranslation = await supabase
          .from("transcriptions")
          .select(COLUMNS_WITH_TRANSLATION)
          .eq("id", id)
          .is("deleted_at", null)
          .single();

        if (withTranslation.data) {
          t = {
            ...withTranslation.data,
            summary: null,
            summary_source_hash: null,
            vocabulary_corrected: null,
            tags: [],
          };
        } else if (isMissingColumnError(withTranslation.error)) {
          const fallback = await supabase.from("transcriptions").select(BASE_COLUMNS).eq("id", id).is("deleted_at", null).single();
          t = fallback.data
            ? {
                ...fallback.data,
                translated_to: null,
                original_text: null,
                summary: null,
                summary_source_hash: null,
                vocabulary_corrected: null,
                tags: [],
              }
            : null;
        }
      }
    }
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

  // Resumen con IA (Fase F5): se parsea acá (server) y se manda ya estructurado al cliente. Un
  // resumen guardado queda "desactualizado" (`summaryStale`) si el texto cambió desde que se
  // generó — se compara por hash, no por igualdad de texto completo (ver `hashSummarySource`),
  // así el cliente nunca recibe/recalcula el hash (server-only, usa `crypto` de Node).
  const summary = parseStoredSummary(t.summary ?? null);
  const summaryStale = summary !== null && t.summary_source_hash !== hashSummarySource(t.text ?? "");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/app" className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent">
        ← Volver
      </Link>
      <TranscriptionDetail
        transcription={t}
        projects={projectsData ?? []}
        audioSrc={audioSrc}
        initialSummary={summary}
        summaryStale={summaryStale}
        initialChatMessages={initialChatMessages}
      />
    </div>
  );
}
