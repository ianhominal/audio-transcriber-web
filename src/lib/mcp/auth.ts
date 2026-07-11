/**
 * Resolves an MCP bearer token to the user it belongs to. Extracted out of
 * `src/app/api/mcp/route.ts` into its own module for the same reason `tools.ts` is separate: Next
 * route handlers may only export the HTTP method handlers (plus a few reserved config exports)
 * — arbitrary named exports like a testable `verifyToken` are not allowed there — and keeping the
 * real auth-decision logic here makes it directly unit-testable with a fake Supabase client,
 * without the MCP protocol/`withMcpAuth` machinery in the way.
 *
 * Mirrors the reference shape from the phase 1 plan: hash the presented token, look it up in
 * `mcp_tokens`, reject unknown/revoked tokens. Fails CLOSED on every branch — an unknown token, a
 * revoked token, a query error, and even a thrown exception (e.g. `hashMcpToken` throwing because
 * `MCP_TOKEN_HASH_SECRET` isn't configured) all resolve to `undefined`, never to an authenticated
 * result. `undefined`/unknown/revoked are all INDISTINGUISHABLE from the caller's point of view on
 * purpose — `mcp-handler`'s `withMcpAuth` maps every one of these to the same generic 401
 * regardless (confirmed by reading its installed source, see the phase 1 report), so there is no
 * way to leak which case occurred even if we wanted to.
 *
 * Deliberately does NOT check/consume the rate limit anymore (it used to — see
 * `checkMcpRateLimit`'s comment below for why that was a CRITICAL bug,
 * `.claude/resources/changelog/2026-07-11.md`, "batching evades the rate limit"). This function
 * runs exactly ONCE per HTTP POST (it IS `withMcpAuth`'s `verifyToken`), but the Streamable HTTP
 * transport lets a single POST carry a JSON-RPC BATCH — an array of N independent `tools/call`
 * messages, each dispatched to its own registered-tool callback in `src/app/api/mcp/route.ts`
 * (confirmed by reading the installed `@modelcontextprotocol/sdk`'s
 * `webStandardStreamableHttp.js`: `handlePostRequest` parses `rawMessage` as either one message or
 * `Array.isArray(rawMessage) ? rawMessage.map(...) : [...]`, then loops `for (const message of
 * messages) { this.onmessage?.(message, ...) }`, one dispatch per message, all from this SAME
 * verified request). If rate-limiting still lived here, a batch of N tool calls would consume
 * exactly ONE unit of a 30-req/60s budget while executing N reads — unbounded read amplification
 * per rate-limited unit. `resolveMcpAuth` now only answers "who is this token" — `tokenId` travels
 * in the returned `extra` precisely so each INDIVIDUAL tool callback can consume its own unit via
 * `authorizeMcpToolCall` below.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashMcpToken } from "./token";

export const MCP_READ_SCOPE = "read:transcriptions";
export const MCP_RATE_LIMIT = 30;
export const MCP_RATE_WINDOW_SECONDS = 60;

export type McpAuthInfo = {
  token: string;
  scopes: string[];
  clientId: string;
  extra: { userId: string; tokenId: string };
};

type McpTokenRow = {
  id: string;
  user_id: string;
  revoked_at: string | null;
};

/** Every MCP tool callback needs the same guard: `withMcpAuth({ required: true })` already
 * guarantees `extra.authInfo` is set before any tool runs, but this is a security-critical,
 * read-of-private-data surface — a cheap, explicit last line of defense costs nothing and means a
 * falsy/undefined userId can never reach a Supabase query, even if some future change to the auth
 * wiring above ever regressed that guarantee. Mirrors the same guard already enforced inside every
 * function in `src/lib/mcp/tools.ts`. Lives alongside `resolveMcpAuth`/`McpAuthInfo` (rather than
 * in `src/app/api/mcp/route.ts`, where it used to live) so it is directly unit-testable — Next.js
 * route handlers may only export HTTP method handlers plus a few reserved config names, so an
 * arbitrary named export like this one is not allowed there. */
export function requireUserId(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
  const userId = extra.authInfo?.extra?.userId;
  return typeof userId === "string" && userId ? userId : null;
}

/** Same rationale/shape as `requireUserId`, for the token's own DB id — needed by
 * `authorizeMcpToolCall` to consume that SPECIFIC token's rate-limit budget, never a
 * client-supplied id (this only ever reads from the server-resolved `authInfo`, never from tool
 * `input`). */
export function requireTokenId(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
  const tokenId = extra.authInfo?.extra?.tokenId;
  return typeof tokenId === "string" && tokenId ? tokenId : null;
}

export async function resolveMcpAuth(
  supabase: SupabaseClient,
  bearerToken: string | undefined
): Promise<McpAuthInfo | undefined> {
  if (!bearerToken) return undefined;

  try {
    const tokenHash = hashMcpToken(bearerToken);

    const { data, error } = await supabase
      .from("mcp_tokens")
      .select("id, user_id, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !data) return undefined;
    const row = data as McpTokenRow;
    if (row.revoked_at) return undefined;

    return {
      token: bearerToken,
      scopes: [MCP_READ_SCOPE],
      clientId: row.user_id,
      extra: { userId: row.user_id, tokenId: row.id },
    };
  } catch {
    // Fail closed on any unexpected error (including hashMcpToken throwing when
    // MCP_TOKEN_HASH_SECRET is missing) — never let an exception fall through to an
    // authenticated state.
    return undefined;
  }
}

/**
 * Atomically checks AND consumes one unit of `tokenId`'s rate-limit budget via the
 * `check_and_touch_mcp_token` RPC (`SECURITY DEFINER`, `service_role`-only EXECUTE — see the
 * migration). MUST be called once per REAL tool invocation — see `resolveMcpAuth`'s comment above
 * for why it can no longer live at the per-HTTP-request auth boundary. The RPC's own UPDATE is
 * atomic per row (Postgres row-level locking), so this is safe to call concurrently for the SAME
 * `tokenId` — which is exactly what happens when a batch dispatches N tool calls without awaiting
 * between them: each call still sees a correctly-serialized, strictly-incrementing count.
 *
 * Fails closed (`false`) on any error or thrown exception — mirrors `resolveMcpAuth`'s contract.
 */
export async function checkMcpRateLimit(supabase: SupabaseClient, tokenId: string): Promise<boolean> {
  try {
    const { data: allowed, error } = await supabase.rpc("check_and_touch_mcp_token", {
      p_token_id: tokenId,
      p_limit: MCP_RATE_LIMIT,
      p_window_seconds: MCP_RATE_WINDOW_SECONDS,
    });
    if (error) return false;
    return allowed === true;
  } catch {
    return false;
  }
}

export type McpToolAuthorization =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauthenticated" | "rate_limited" };

/**
 * Full authorization check for ONE tool invocation — call this at the top of EVERY registered
 * tool callback in `src/app/api/mcp/route.ts`, never `requireUserId` alone, and never rely on
 * `resolveMcpAuth` for rate-limiting (see its comment for why). Resolves `userId`/`tokenId` from
 * the request's already-verified `authInfo` (set once per HTTP request by `withMcpAuth`), then
 * consumes one unit of THAT token's rate-limit budget. `supabase` must be a service-role client —
 * `check_and_touch_mcp_token`'s EXECUTE grant is restricted to `service_role` (see the migration).
 */
export async function authorizeMcpToolCall(
  supabase: SupabaseClient,
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): Promise<McpToolAuthorization> {
  const userId = requireUserId(extra);
  if (!userId) return { ok: false, reason: "unauthenticated" };

  const tokenId = requireTokenId(extra);
  if (!tokenId) return { ok: false, reason: "unauthenticated" };

  const allowed = await checkMcpRateLimit(supabase, tokenId);
  if (!allowed) return { ok: false, reason: "rate_limited" };

  return { ok: true, userId };
}
