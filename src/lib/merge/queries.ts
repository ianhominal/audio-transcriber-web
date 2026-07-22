import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_MERGE_NOTES } from "./validate";

export type MergeCandidateNote = { id: string; title: string; createdAt: string };
export type MergeCandidates = { notes: MergeCandidateNote[]; totalNotesInProject: number };

/**
 * Resolves the notes offered for "Combinar en documento" ("merge into one document") in a project:
 * up to `MAX_MERGE_NOTES` DIRECT notes in the project (oldest first) — the SAME criteria `/app/merge`
 * (`merge/page.tsx`) already used before this extraction. Reused here so the dashboard
 * (`src/app/app/page.tsx`) can pass the exact same note set to the "Combinar en documento" action
 * embedded in the assistant (`ChatPanel`/`ProjectChatButton`, feature 2026-07-22 phase 2) — both
 * entry points offer EXACTLY the same notes, without duplicating the query.
 *
 * `totalNotesInProject` is the REAL total (uncapped) — lets the caller warn when the project has more
 * notes than the merge cap allows, even though the returned list is already capped at
 * `MAX_MERGE_NOTES`.
 *
 * Ownership: explicit `user_id` on top of RLS (defense-in-depth, same criteria as
 * `/api/notes/merge`) — the caller is responsible for passing the right `userId` (`user?.id ?? ""` if
 * `user` could be `null`, same fail-safe pattern used elsewhere in this app).
 */
export async function fetchMergeCandidates(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<MergeCandidates> {
  const { data: notesData } = await supabase
    .from("transcriptions")
    .select("id, title, created_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_MERGE_NOTES);

  const notes: MergeCandidateNote[] = (
    (notesData ?? []) as { id: string; title: string | null; created_at: string }[]
  ).map((n) => ({ id: n.id, title: n.title ?? "Sin título", createdAt: n.created_at }));

  // Lightweight count-only query (same filters as above minus `user_id`/order, no rows fetched) —
  // same criteria `merge/page.tsx` already used: whether the project has MORE direct notes than
  // `MAX_MERGE_NOTES`, something the query above can't tell (it comes back capped).
  const { count } = await supabase
    .from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("deleted_at", null);

  return { notes, totalNotesInProject: count ?? notes.length };
}
