/**
 * Team Sharing slice 1b, Phase 14 (design ADR-05, spec "MCP y el asistente de IA alcanzan lo
 * compartido en lectura"): the ONLY module in `lib/mcp/` allowed to touch permissions.
 *
 * MCP (`src/app/api/mcp/route.ts`) authenticates via an opaque bearer token resolved against
 * `mcp_tokens` with the SERVICE-ROLE client (see `lib/mcp/auth.ts`) — there is no logged-in
 * session, so **RLS does not apply at all** to any query `lib/mcp/tools.ts` runs. Before this
 * phase, every read tool compensated with a hand-written `.eq("user_id", userId)`, which is
 * correct for private data but structurally cannot see a project shared via `project_members`.
 *
 * `getAccessibleProjectIds` is a thin wrapper over the `accessible_project_ids` RPC — the exact
 * same SQL function the RLS policies themselves resolve through (see
 * `20260728150000_permission_kernel.sql`, function 5). There is deliberately no second
 * implementation of "what can this user read" here: `role_has_capability`/`project_role_at_root`
 * stay the single source of truth (I-1/I-2 in design.md), this file only calls them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Builds a PostgREST `.or()` filter string: "the row belongs to the caller, OR its `idColumn`
 * is one of the caller's accessible project ids." Pure — no I/O — so the filter shape is
 * independently testable without a fake Supabase client.
 *
 * `idColumn` defaults to `"project_id"` (the shape every `transcriptions` read needs). Pass
 * `"id"` for the `projects` table itself, where the accessible id IS the row's own id.
 *
 * Guards against building `foo.in.()` (an empty parenthesized list), which is not valid
 * PostgREST filter syntax: with zero accessible projects the caller can still only see their own
 * rows, so the `.in()` clause is dropped entirely rather than emitted empty.
 */
export function buildOwnOrAccessibleFilter(
  userId: string,
  accessibleProjectIds: readonly string[],
  idColumn: "project_id" | "id" = "project_id"
): string {
  const own = `user_id.eq.${userId}`;
  if (accessibleProjectIds.length === 0) return own;
  return `${own},${idColumn}.in.(${accessibleProjectIds.join(",")})`;
}

/**
 * Resolves the project ids the given user can act on with `capability` (default `'read'` — MCP
 * is read-only in this phase, ADR-05 regla 3). Every read tool in `tools.ts` MUST call this
 * BEFORE building its query and combine the result with `buildOwnOrAccessibleFilter` — this is
 * the only thing standing between a bearer token and another user's shared-project data, since
 * the service-role client bypasses RLS entirely.
 *
 * Fails CLOSED: any RPC error (or a null/missing `data`) returns an empty list instead of
 * throwing. The caller still gets their own rows via the `user_id.eq` branch of
 * `buildOwnOrAccessibleFilter` — this never silently WIDENS access on error, only narrows it back
 * to "own data only", same failure direction as deny-by-default (I-3 in design.md).
 */
export async function getAccessibleProjectIds(
  supabase: SupabaseClient,
  userId: string,
  capability: string = "read"
): Promise<string[]> {
  if (!userId) return [];

  const { data, error } = await supabase.rpc("accessible_project_ids", {
    p_user_id: userId,
    p_capability: capability,
  });
  if (error || !data) return [];

  // Defensive against both PostgREST response shapes for a `returns setof uuid` function
  // without a named OUT parameter: an array of `{ accessible_project_ids: uuid }` objects (the
  // documented behavior — the JSON key defaults to the function name), or a flat array of plain
  // uuid strings. Either way the caller only ever needs the ids themselves.
  return (data as unknown[])
    .map((row) => (typeof row === "string" ? row : (Object.values(row as Record<string, unknown>)[0] as string)))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
