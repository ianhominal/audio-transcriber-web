import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { generateMcpToken } from "@/lib/mcp/token";
import { sanitizeMcpTokenLabel } from "./validate";

/**
 * Logged-in-user-side CRUD for their own MCP tokens (Phase 2 — the management counterpart to the
 * Phase 1 read-only MCP server, see `src/lib/mcp/token.ts`/`auth.ts`/`tools.ts` and
 * `.claude/resources/changelog/2026-07-11.md`).
 *
 * Unlike `src/lib/mcp/tools.ts` (which runs against the service-role client because there is no
 * user session on an MCP request), `listMcpTokens`/`createMcpToken` run against the RLS-scoped
 * Supabase client that `getApiUser` already provides — exactly like `src/lib/vocabulary/store.ts`
 * — because these are mutations initiated by the logged-in user from Settings, not by an external
 * MCP client. This is necessary, not just stylistic, for `createMcpToken`: the
 * `enforce_mcp_token_limit` trigger (migration `20260711150000_mcp_tokens.sql`) counts ACTIVE
 * tokens with `SECURITY INVOKER`, so the 10-per-user cap depends on the INSERT running with the
 * caller's own JWT — inserting via the service-role client would break that scoping (RLS would no
 * longer bound the `count(*)` to the owner).
 *
 * `revokeMcpToken` is the ONE exception — it's called with a SERVICE-ROLE client (see
 * `src/app/api/mcp-tokens/[id]/route.ts`), not the RLS-scoped one, since a CRITICAL fix
 * (`.claude/resources/changelog/2026-07-11.md`) removed `authenticated`'s UPDATE grant on
 * `mcp_tokens` entirely (a column-scoped grant restricting writes to `revoked_at` only still let a
 * token's owner PATCH it back to `null` via raw PostgREST — a GRANT restricts WHICH column, never
 * WHAT VALUE). `revokeMcpToken`'s own `.eq("user_id", userId)` filter is what keeps it scoped to
 * the caller's own rows now — not RLS, since a service-role client bypasses RLS entirely — same
 * IDOR discipline as `tools.ts`. This function still takes `supabase` as a parameter (rather than
 * constructing its own client) purely to stay unit-testable with a fake client.
 *
 * `token_hash` is NEVER selected in `listMcpTokens`, nor logged/sent to Sentry on any error branch
 * in this file — the only place the RAW token exists is in `createMcpToken`'s return value, which
 * the route handler returns to the client exactly once.
 */

export type McpTokenSummary = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/**
 * True if the error comes from the DB's `enforce_mcp_token_limit` trigger (the user already has
 * the maximum of 10 ACTIVE tokens). Same mechanism as `isTermLimitError` in
 * `src/lib/vocabulary/store.ts`: detected via a STABLE substring of the message
 * (`mcp_token_limit_reached`), never via SQLSTATE — the raw Postgres message is never forwarded to
 * the client, it's only used here to decide the Spanish copy.
 */
function isTokenLimitError(error: { message?: unknown } | null): boolean {
  return !!error && typeof error.message === "string" && error.message.includes("mcp_token_limit_reached");
}

/**
 * Lists the user's MCP tokens, both active AND revoked, newest first. Revoked ones are included ON
 * PURPOSE: they're a useful audit trail (same append-mostly rationale the migration documents for
 * the soft-delete), and the UI shows them with a "Revoked" badge instead of making them disappear.
 *
 * Return-object fields are picked explicitly (not a spread of the row) so a future accidental
 * `select("*")` in the query above still can't leak `token_hash` — this function never forwards it
 * even if it were present in `data`.
 */
export async function listMcpTokens(supabase: SupabaseClient, userId: string): Promise<McpTokenSummary[]> {
  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("id, label, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[mcp-tokens] listMcpTokens failed", { userId, error: error.message });
    Sentry.captureException(error, { extra: { userId, stage: "list-mcp-tokens" } });
    return [];
  }

  return ((data as McpTokenSummary[]) ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }));
}

export type CreateMcpTokenResult =
  | { ok: true; id: string; label: string; created_at: string; token: string }
  | { ok: false; error: string; code?: "limit" };

/**
 * Creates a new MCP token: generates the opaque token + its hash (`generateMcpToken`, Phase 1 —
 * never reimplemented here), inserts `{user_id, label, token_hash}` via the caller's RLS-scoped
 * client. The 10-ACTIVE-tokens cap is guaranteed ATOMICALLY by the DB's `BEFORE INSERT` trigger
 * (same TOCTOU-safe rationale as `addVocabularyTerm`) — never a count-then-insert here.
 *
 * The RAW token is never logged (neither in `console.error` nor in Sentry's error-branch `extra`)
 * nor persisted anywhere beyond THIS function's return value — the caller (route handler) returns
 * it to the client exactly once, in the 201 response.
 */
export async function createMcpToken(
  supabase: SupabaseClient,
  userId: string,
  rawLabel: unknown
): Promise<CreateMcpTokenResult> {
  const label = sanitizeMcpTokenLabel(rawLabel);
  const { token, hash } = generateMcpToken();

  const { data, error } = await supabase
    .from("mcp_tokens")
    .insert({ user_id: userId, label, token_hash: hash })
    .select("id, label, created_at")
    .single();

  if (error || !data) {
    if (isTokenLimitError(error)) {
      return {
        ok: false,
        error: "Llegaste al máximo de 10 tokens activos. Revocá alguno para poder crear uno nuevo.",
        code: "limit",
      };
    }
    console.error("[mcp-tokens] createMcpToken failed", { userId, error: error?.message });
    Sentry.captureException(error ?? new Error("insert returned no data"), {
      extra: { userId, stage: "create-mcp-token" },
    });
    return { ok: false, error: "No se pudo crear el token." };
  }

  const row = data as { id: string; label: string; created_at: string };
  return { ok: true, id: row.id, label: row.label, created_at: row.created_at, token };
}

export type RevokeMcpTokenResult =
  | { ok: true; token: McpTokenSummary }
  | { ok: false; error: string; code: "not_found" | "server_error" };

/**
 * Revokes a token by setting `revoked_at = now()`, atomic in ONE single query (`UPDATE ... WHERE
 * ... RETURNING`, not a separate SELECT-then-UPDATE). Scoped by `id` AND `user_id` PLUS
 * `revoked_at is null`. Expects a SERVICE-ROLE `supabase` client (see the file header comment) —
 * `id`+`user_id` are this call's ONLY scoping mechanism, not defense-in-depth on top of RLS: a
 * service-role client bypasses RLS entirely, so if this function ever forgot the `user_id` filter,
 * nothing else in the stack would catch a cross-user revoke.
 *
 * NEVER accepts a caller-supplied `revoked_at` — the only value this function ever writes is a
 * freshly-generated `new Date().toISOString()`, and the query only ever matches rows where
 * `revoked_at is null`. There is no code path here, or anywhere else in the app, that could set
 * `revoked_at` back to `null` — the migration's `enforce_mcp_token_revocation_immutable` trigger
 * enforces that same invariant again at the DB layer, independent of this function.
 *
 * If the id doesn't exist, belongs to ANOTHER user, or was already revoked, the query affects ZERO
 * rows — all three situations are INDISTINGUISHABLE from the outside (same "uniform not-found"
 * rationale as `getTranscription` in `src/lib/mcp/tools.ts`): all three return the same 404, never
 * a silent 200 nor any hint of which of the three cases actually happened.
 */
export async function revokeMcpToken(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<RevokeMcpTokenResult> {
  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id, label, created_at, last_used_at, revoked_at")
    .maybeSingle();

  if (error) {
    console.error("[mcp-tokens] revokeMcpToken failed", { userId, id, error: error.message });
    Sentry.captureException(error, { extra: { userId, id, stage: "revoke-mcp-token" } });
    return { ok: false, error: "No se pudo revocar el token.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "Token no encontrado.", code: "not_found" };
  }

  const row = data as McpTokenSummary;
  return {
    ok: true,
    token: {
      id: row.id,
      label: row.label,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
    },
  };
}
