import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { revokeMcpToken } from "@/lib/mcp-tokens/store";

export const runtime = "nodejs";

/**
 * Revokes an MCP token (soft-delete via `revoked_at`, never a DELETE). Requires a session — but,
 * unlike `GET`/`POST` in `../route.ts`, the actual UPDATE runs against the SERVICE-ROLE client, not
 * the caller's RLS-scoped session client (CRITICAL fix, see
 * `.claude/resources/changelog/2026-07-11.md` and the RLS comment in
 * `supabase/migrations/20260711150000_mcp_tokens.sql`): `authenticated` now has NO update grant at
 * all on `mcp_tokens` (a column-scoped grant used to allow writing `revoked_at` only, but a GRANT
 * restricts WHICH column, never WHAT VALUE — that still let a token's own owner PATCH `revoked_at`
 * back to `null` via raw PostgREST and resurrect a revoked token). Revocation is now SERVER-SIDE
 * ONLY: this route is the sole path that can write `revoked_at`, still fully gated by
 * `getApiUser`'s session check, and `revokeMcpToken` itself keeps its explicit
 * `.eq("user_id", userId)` filter — since a service-role client bypasses RLS entirely, that
 * explicit filter (not RLS) is what keeps this scoped to the caller's own rows, same IDOR
 * discipline as `src/lib/mcp/tools.ts`. `id` not existing, belonging to ANOTHER user, or already
 * being revoked all produce the SAME 404 — never a silent 200 — see the comment on `revokeMcpToken`
 * in `src/lib/mcp-tokens/store.ts`.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const result = await revokeMcpToken(createServiceRoleClient(), user.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 500 });
  }
  return NextResponse.json({ token: result.token });
}
