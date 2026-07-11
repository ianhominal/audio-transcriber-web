import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));
vi.mock("@/lib/supabase/serviceRole", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { PATCH } from "./route";

type TokenRow = {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/**
 * Fake Supabase client that REALLY filters by the accumulated `.eq()`/`.is()` chain on `update()`,
 * same approach as the fake in `tools.test.ts` (Phase 1): the point of this test is to prove that
 * `revokeMcpToken`'s own `.eq("user_id", userId)` is what blocks a cross-user revoke — a fake that
 * only recorded calls without actually filtering would let a real ownership bug slip past with no
 * test catching it. This stands in for the SERVICE-ROLE client (`createServiceRoleClient`) after
 * the CRITICAL-2 fix (`.claude/resources/changelog/2026-07-11.md`): there is no RLS in this fake,
 * on purpose — a real service-role client bypasses RLS entirely too, so whatever this route/store
 * doesn't filter explicitly is not filtered at all, same as production.
 */
function createFakeSupabase(seedRows: TokenRow[]) {
  const rows: TokenRow[] = seedRows.map((r) => ({ ...r }));

  function updateBuilder(patch: Partial<TokenRow>, filters: Array<[string, unknown]>) {
    const builder = {
      eq(col: string, val: unknown) {
        return updateBuilder(patch, [...filters, [col, val]]);
      },
      is(col: string, val: unknown) {
        return updateBuilder(patch, [...filters, [col, val]]);
      },
      select() {
        return {
          maybeSingle() {
            const idx = rows.findIndex((row) =>
              filters.every(([col, val]) => (row as Record<string, unknown>)[col] === val)
            );
            if (idx === -1) return Promise.resolve({ data: null, error: null });
            rows[idx] = { ...rows[idx], ...patch };
            return Promise.resolve({ data: { ...rows[idx] }, error: null });
          },
        };
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      if (table !== "mcp_tokens") throw new Error(`Unexpected table in test: ${table}`);
      return {
        update(patch: Partial<TokenRow>) {
          return updateBuilder(patch, []);
        },
      };
    },
  };
}

/** Stands in for the caller's RLS-scoped session client (`getApiUser`'s `supabase`). Throws on
 * ANY use — the CRITICAL-2 regression this guards against is exactly "the revoke path still
 * touches the session-scoped client somewhere" (which would mean the old, un-revocation-vulnerable
 * PostgREST UPDATE path is still reachable). If any test below fails because this throws, that IS
 * the bug: revocation must go through the service-role client only. */
function poisonedSessionSupabase() {
  return {
    from() {
      throw new Error("CRITICAL-2 regression: revocation must never touch the session-scoped client");
    },
  };
}

function mockSession(userId: string | null) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: poisonedSessionSupabase() as never,
    user: userId ? ({ id: userId } as never) : null,
  });
}

function mockServiceRoleClient(supabase: ReturnType<typeof createFakeSupabase>) {
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase as never);
}

function patchToken(id: string) {
  return PATCH(new Request(`http://localhost/api/mcp-tokens/${id}`, { method: "PATCH" }) as never, {
    params: Promise.resolve({ id }),
  });
}

function makeRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: "tok-1",
    user_id: "u1",
    label: "Claude Desktop",
    created_at: "2026-07-11T00:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
});

describe("PATCH /api/mcp-tokens/[id]", () => {
  it("401 without a session — never even constructs a service-role client", async () => {
    mockSession(null);
    const res = await patchToken("tok-1");
    expect(res.status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("CRITICAL-2 regression: revokes via the SERVICE-ROLE client, never the caller's session-scoped client", async () => {
    mockSession("u1");
    mockServiceRoleClient(createFakeSupabase([makeRow()]));

    // If the route/store ever touched `getApiUser`'s session-scoped `supabase` for the revoke
    // itself, `poisonedSessionSupabase` above throws and this request would 500, not 200 — see its
    // comment for why that's exactly the CRITICAL-2 regression this pins down.
    const res = await patchToken("tok-1");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token.revoked_at).toBeTruthy();
    expect(json.token).not.toHaveProperty("token_hash");
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
  });

  it("IDOR: revoking ANOTHER user's token fails cleanly, never a silent 200", async () => {
    mockSession("user-A");
    mockServiceRoleClient(createFakeSupabase([makeRow({ id: "victim-token", user_id: "user-B" })]));

    const res = await patchToken("victim-token");

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(200);
  });

  it("404 for a nonexistent id", async () => {
    mockSession("u1");
    mockServiceRoleClient(createFakeSupabase([]));
    const res = await patchToken("no-existe");
    expect(res.status).toBe(404);
  });

  it("404 for an already-revoked token (not a silent 200 no-op) — same shape as IDOR/nonexistent, never a hint it was already revoked", async () => {
    mockSession("u1");
    mockServiceRoleClient(createFakeSupabase([makeRow({ revoked_at: "2026-07-01T00:00:00.000Z" })]));
    const res = await patchToken("tok-1");
    expect(res.status).toBe(404);
  });
});
