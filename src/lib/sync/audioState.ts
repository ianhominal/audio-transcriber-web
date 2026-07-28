import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Team Sharing slice 1b, Phase 11 (design ADR-14 §3, spec "Estado de audio explícito en el
 * read-path"). Both clients (desktop pull, web detail) must show the SAME derived state instead
 * of a broken player or a silent 404 — this module is the one place that derives it, so the rule
 * is written once (ADR-13: one server contract, two views).
 */
export type AudioState = "available" | "pending_upload" | "unavailable";

/**
 * PURE. `available` when the blob is already in the cloud, independent of sharing. Otherwise
 * `pending_upload` when the project has more than one member (owner still has it locally and can
 * upload it, or a collaborator is waiting on it) — never `unavailable` for a shared project,
 * because that copy would read as "gone forever" instead of "not uploaded yet". `unavailable`
 * covers everything else: a private (single-member) project without the blob, or a purged one.
 */
export function computeAudioState(
  audioUrl: string | null | undefined,
  memberCount: number
): AudioState {
  if (audioUrl) return "available";
  return memberCount > 1 ? "pending_upload" : "unavailable";
}

type ProjectRootRow = { id: string; root_project_id?: string | null };
type MemberRow = { project_id: string };

/**
 * Resolves, for a batch of `projectId`s, how many members the project's ROOT has in
 * `project_members` (membership is always keyed by the root — see `project_role_at_root` in the
 * permission kernel, design.md §2). Returns a map keyed by the ORIGINAL `projectId`s passed in
 * (not the resolved roots), so callers never need to know about the root indirection.
 *
 * Expand/contract on TWO independent migrations that may not be applied yet in production (Phase
 * 1 `root_project_id`, Phase 2 `project_members`): any error from either query (missing column,
 * missing table, or anything else) makes this function degrade to `memberCount = 1` for the
 * affected projects instead of throwing — the caller (pull, detail page) must never 500 just
 * because sharing's tables are not live yet. `memberCount = 1` is the correct degraded value: it
 * is exactly the pre-sharing behavior (`computeAudioState` never returns `pending_upload`).
 */
export async function resolveMemberCountsByProject(
  supabase: SupabaseClient,
  projectIds: Array<string | null | undefined>
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(projectIds.filter((id): id is string => !!id)));
  if (unique.length === 0) return new Map();

  const { data: projectRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, root_project_id")
    .in("id", unique);

  const rootByProject = new Map<string, string>();
  if (!projectsError) {
    for (const row of (projectRows ?? []) as ProjectRootRow[]) {
      rootByProject.set(row.id, row.root_project_id ?? row.id);
    }
  }
  // Degraded (column missing, or the row simply wasn't returned): treat the project as its own
  // root — no subtree awareness, but still a valid (if conservative) member count.
  for (const id of unique) {
    if (!rootByProject.has(id)) rootByProject.set(id, id);
  }

  const roots = Array.from(new Set(rootByProject.values()));
  const { data: memberRows, error: membersError } = await supabase
    .from("project_members")
    .select("project_id")
    .in("project_id", roots);

  const countByRoot = new Map<string, number>();
  if (!membersError) {
    for (const row of (memberRows ?? []) as MemberRow[]) {
      countByRoot.set(row.project_id, (countByRoot.get(row.project_id) ?? 0) + 1);
    }
  }
  // `membersError` (typically `project_members` not applied yet) leaves `countByRoot` empty, so
  // every project below defaults to 1 — same degraded-but-safe rationale as above.

  const result = new Map<string, number>();
  for (const id of unique) {
    const root = rootByProject.get(id)!;
    result.set(id, countByRoot.get(root) ?? 1);
  }
  return result;
}
