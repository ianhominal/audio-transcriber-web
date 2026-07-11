import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveMcpAuth,
  requireUserId,
  requireTokenId,
  checkMcpRateLimit,
  authorizeMcpToolCall,
  MCP_READ_SCOPE,
} from "./auth";

const ORIGINAL_SECRET = process.env.MCP_TOKEN_HASH_SECRET;

function restoreSecret() {
  if (ORIGINAL_SECRET === undefined) delete process.env.MCP_TOKEN_HASH_SECRET;
  else process.env.MCP_TOKEN_HASH_SECRET = ORIGINAL_SECRET;
}

type TokenRow = { id: string; user_id: string; revoked_at: string | null } | null;

/** Fake Supabase client covering exactly the calls `resolveMcpAuth`/`checkMcpRateLimit` make: a
 * `mcp_tokens` lookup by `token_hash`, and the `check_and_touch_mcp_token` RPC. Records every call
 * so tests can assert exactly how many times each happened — that count IS the regression test for
 * the batching fix (CRITICAL 1, `.claude/resources/changelog/2026-07-11.md`): rate-limiting must
 * happen once per REAL tool call, never once per HTTP request. */
function createFakeSupabase(options: {
  tokenRow?: TokenRow;
  selectError?: { message: string } | null;
  rpcAllowed?: boolean;
  rpcError?: { message: string } | null;
  rpcThrows?: boolean;
}) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const fromCalls: string[] = [];

  return {
    from(table: string) {
      fromCalls.push(table);
      if (table !== "mcp_tokens") throw new Error(`Unexpected table in test: ${table}`);
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        maybeSingle() {
          return Promise.resolve({ data: options.tokenRow ?? null, error: options.selectError ?? null });
        },
      };
      return q;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      if (options.rpcThrows) throw new Error("simulated RPC transport failure");
      return Promise.resolve({ data: options.rpcAllowed ?? true, error: options.rpcError ?? null });
    },
    rpcCalls,
    fromCalls,
  };
}

beforeEach(() => {
  process.env.MCP_TOKEN_HASH_SECRET = "unit-test-secret-do-not-use-in-prod";
});

afterEach(restoreSecret);

describe("resolveMcpAuth", () => {
  it("returns undefined and never touches Supabase when there is no bearer token", async () => {
    const supabase = createFakeSupabase({});
    const result = await resolveMcpAuth(supabase as never, undefined);
    expect(result).toBeUndefined();
    expect(supabase.fromCalls).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("returns undefined for an empty-string bearer token, without touching Supabase", async () => {
    const supabase = createFakeSupabase({});
    const result = await resolveMcpAuth(supabase as never, "");
    expect(result).toBeUndefined();
    expect(supabase.fromCalls).toHaveLength(0);
  });

  it("returns undefined when no token row matches the hash (unknown token)", async () => {
    const supabase = createFakeSupabase({ tokenRow: null });
    const result = await resolveMcpAuth(supabase as never, "mcpt_unknown");
    expect(result).toBeUndefined();
  });

  it("returns undefined for a revoked token — indistinguishable from unknown", async () => {
    const supabase = createFakeSupabase({
      tokenRow: { id: "tok-1", user_id: "user-A", revoked_at: "2026-07-05T00:00:00.000Z" },
    });
    const result = await resolveMcpAuth(supabase as never, "mcpt_revoked");
    expect(result).toBeUndefined();
  });

  it("fails closed when the token lookup query errors", async () => {
    const supabase = createFakeSupabase({ tokenRow: null, selectError: { message: "connection reset" } });
    const result = await resolveMcpAuth(supabase as never, "mcpt_whatever");
    expect(result).toBeUndefined();
  });

  it("fails closed (returns undefined, does not throw) when MCP_TOKEN_HASH_SECRET is missing", async () => {
    delete process.env.MCP_TOKEN_HASH_SECRET;
    const supabase = createFakeSupabase({ tokenRow: { id: "tok-1", user_id: "user-A", revoked_at: null } });
    await expect(resolveMcpAuth(supabase as never, "mcpt_whatever")).resolves.toBeUndefined();
  });

  it("resolves a valid, non-revoked token to auth info scoped to its owner, including the token's own id", async () => {
    const supabase = createFakeSupabase({
      tokenRow: { id: "tok-1", user_id: "user-A", revoked_at: null },
    });

    const result = await resolveMcpAuth(supabase as never, "mcpt_validtoken");

    expect(result).toEqual({
      token: "mcpt_validtoken",
      scopes: [MCP_READ_SCOPE],
      clientId: "user-A",
      extra: { userId: "user-A", tokenId: "tok-1" },
    });
  });

  it("CRITICAL-1 regression: never touches the rate-limit RPC — rate limiting happens per tool call now (authorizeMcpToolCall), never once per HTTP request", async () => {
    const supabase = createFakeSupabase({
      tokenRow: { id: "tok-1", user_id: "user-A", revoked_at: null },
    });

    await resolveMcpAuth(supabase as never, "mcpt_validtoken");

    expect(supabase.rpcCalls).toHaveLength(0);
  });
});

describe("requireUserId", () => {
  it("returns null when authInfo itself is missing", () => {
    expect(requireUserId({})).toBeNull();
  });

  it("returns null when authInfo.extra is missing", () => {
    expect(requireUserId({ authInfo: {} })).toBeNull();
  });

  it("returns null when authInfo.extra.userId is missing", () => {
    expect(requireUserId({ authInfo: { extra: {} } })).toBeNull();
  });

  it("returns null when authInfo.extra.userId is undefined", () => {
    expect(requireUserId({ authInfo: { extra: { userId: undefined } } })).toBeNull();
  });

  it("returns null when authInfo.extra.userId is an empty string", () => {
    expect(requireUserId({ authInfo: { extra: { userId: "" } } })).toBeNull();
  });

  it("returns null when authInfo.extra.userId is not a string", () => {
    expect(requireUserId({ authInfo: { extra: { userId: 123 } } })).toBeNull();
  });

  it("returns the userId as-is when it is a valid non-empty string", () => {
    expect(requireUserId({ authInfo: { extra: { userId: "user-A" } } })).toBe("user-A");
  });
});

describe("requireTokenId", () => {
  it("returns null when authInfo itself is missing", () => {
    expect(requireTokenId({})).toBeNull();
  });

  it("returns null when authInfo.extra.tokenId is missing", () => {
    expect(requireTokenId({ authInfo: { extra: {} } })).toBeNull();
  });

  it("returns null when authInfo.extra.tokenId is an empty string", () => {
    expect(requireTokenId({ authInfo: { extra: { tokenId: "" } } })).toBeNull();
  });

  it("returns null when authInfo.extra.tokenId is not a string", () => {
    expect(requireTokenId({ authInfo: { extra: { tokenId: 123 } } })).toBeNull();
  });

  it("returns the tokenId as-is when it is a valid non-empty string", () => {
    expect(requireTokenId({ authInfo: { extra: { tokenId: "tok-1" } } })).toBe("tok-1");
  });
});

describe("checkMcpRateLimit", () => {
  it("returns true when the RPC reports allowed", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    expect(await checkMcpRateLimit(supabase as never, "tok-1")).toBe(true);
  });

  it("returns false when the RPC reports not allowed (limit exceeded)", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: false });
    expect(await checkMcpRateLimit(supabase as never, "tok-1")).toBe(false);
  });

  it("fails closed (false) when the RPC returns an error", async () => {
    const supabase = createFakeSupabase({ rpcError: { message: "connection reset" } });
    expect(await checkMcpRateLimit(supabase as never, "tok-1")).toBe(false);
  });

  it("fails closed (false), does not throw, when the RPC call itself throws", async () => {
    const supabase = createFakeSupabase({ rpcThrows: true });
    await expect(checkMcpRateLimit(supabase as never, "tok-1")).resolves.toBe(false);
  });

  it("calls check_and_touch_mcp_token with the given tokenId and the configured limit/window", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    await checkMcpRateLimit(supabase as never, "tok-specific-id");
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.rpcCalls[0].fn).toBe("check_and_touch_mcp_token");
    expect(supabase.rpcCalls[0].args).toMatchObject({ p_token_id: "tok-specific-id" });
  });
});

describe("authorizeMcpToolCall", () => {
  it("ok:false, unauthenticated when userId is missing from extra — never touches the RPC", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    const result = await authorizeMcpToolCall(supabase as never, { authInfo: { extra: { tokenId: "tok-1" } } });
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("ok:false, unauthenticated when tokenId is missing from extra — never touches the RPC", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    const result = await authorizeMcpToolCall(supabase as never, { authInfo: { extra: { userId: "user-A" } } });
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("ok:false, rate_limited when the token is over budget — never returns a userId", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: false });
    const result = await authorizeMcpToolCall(supabase as never, {
      authInfo: { extra: { userId: "user-A", tokenId: "tok-1" } },
    });
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("ok:true with the resolved userId when authenticated and within budget", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    const result = await authorizeMcpToolCall(supabase as never, {
      authInfo: { extra: { userId: "user-A", tokenId: "tok-1" } },
    });
    expect(result).toEqual({ ok: true, userId: "user-A" });
  });

  it("consumes the rate-limit budget of THIS token's own id, never anything client-supplied", async () => {
    const supabase = createFakeSupabase({ rpcAllowed: true });
    await authorizeMcpToolCall(supabase as never, { authInfo: { extra: { userId: "user-A", tokenId: "tok-specific" } } });
    expect(supabase.rpcCalls[0].args).toMatchObject({ p_token_id: "tok-specific" });
  });

  it("THE CRITICAL-1 test: N tool calls consume N units of budget, not one — proves batching can no longer evade the rate limit", async () => {
    // Simulates a single JSON-RPC batch (one HTTP POST) carrying 10 `tools/call` messages: the MCP
    // transport dispatches each independently to its own registered-tool callback
    // (`src/app/api/mcp/route.ts`), and EVERY one of those callbacks calls `authorizeMcpToolCall`
    // first, with the SAME `extra` (same authenticated request). Before the fix, only
    // `resolveMcpAuth` (once per HTTP POST) touched the rate limit — 10 tool calls would have
    // consumed exactly 1 unit. After the fix, this must be 10 calls to the RPC for 10 tool calls.
    const supabase = createFakeSupabase({ rpcAllowed: true });
    const extra = { authInfo: { extra: { userId: "user-A", tokenId: "tok-1" } } };

    const batchSize = 10;
    const results = await Promise.all(
      Array.from({ length: batchSize }, () => authorizeMcpToolCall(supabase as never, extra))
    );

    expect(supabase.rpcCalls).toHaveLength(batchSize);
    expect(supabase.rpcCalls.every((call) => call.fn === "check_and_touch_mcp_token")).toBe(true);
    expect(results.every((r) => r.ok === true)).toBe(true);
  });

  it("once the fake DB-side counter reports the limit is hit, further calls in the SAME batch are rejected — not silently allowed", async () => {
    // A slightly more realistic fake: the first `allowedUpTo` calls report allowed=true (mirroring
    // `check_and_touch_mcp_token`'s own `rate_window_count <= p_limit` RETURNING), the rest false.
    const allowedUpTo = 3;
    let calls = 0;
    const rpcCalls: unknown[] = [];
    const supabase = {
      rpc(fn: string, args: unknown) {
        calls += 1;
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: calls <= allowedUpTo, error: null });
      },
    };
    const extra = { authInfo: { extra: { userId: "user-A", tokenId: "tok-1" } } };

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await authorizeMcpToolCall(supabase as never, extra));
    }

    expect(results.filter((r) => r.ok).length).toBe(allowedUpTo);
    expect(results.filter((r) => !r.ok && r.reason === "rate_limited").length).toBe(5 - allowedUpTo);
    expect(rpcCalls).toHaveLength(5);
  });
});
