import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `getApiUser` does real I/O (cookies/JWT) — mocked to inject a fixed user and a fake Supabase
// client controlled by each test, same pattern as `api/chat/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { GET, POST } from "./route";

type TokenRow = {
  id: string;
  user_id: string;
  label: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type InsertResult = {
  data: { id: string; label: string; created_at: string } | null;
  error: { message: string } | null;
};

const ORIGINAL_SECRET = process.env.MCP_TOKEN_HASH_SECRET;

function restoreSecret() {
  if (ORIGINAL_SECRET === undefined) delete process.env.MCP_TOKEN_HASH_SECRET;
  else process.env.MCP_TOKEN_HASH_SECRET = ORIGINAL_SECRET;
}

/**
 * Fake Supabase client: covers exactly the two shapes the store uses —
 * `select().eq().order()` to list, and `insert().select().single()` to create. It doesn't need to
 * actually filter by `user_id` (unlike the fake in `[id]/route.test.ts`) because no "other user's"
 * row is ever seeded here — cross-user ownership scoping is what the IDOR test in the `[id]` route
 * covers, not this one.
 */
function createFakeSupabase(options: { rows?: TokenRow[]; insertResult?: InsertResult }) {
  const insertCalls: Record<string, unknown>[] = [];

  return {
    from(table: string) {
      if (table !== "mcp_tokens") throw new Error(`Unexpected table in test: ${table}`);
      return {
        select() {
          const q = {
            eq() {
              return q;
            },
            order() {
              return Promise.resolve({ data: options.rows ?? [], error: null });
            },
          };
          return q;
        },
        insert(payload: Record<string, unknown>) {
          insertCalls.push(payload);
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve(
                    options.insertResult ?? { data: null, error: { message: "no insertResult configured" } }
                  ),
              };
            },
          };
        },
      };
    },
    insertCalls,
  };
}

function mockUser(supabase: ReturnType<typeof createFakeSupabase>) {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });
}

function getTokens() {
  return GET(new Request("http://localhost/api/mcp-tokens") as never);
}

function postTokens(body: unknown) {
  const req =
    typeof body === "string"
      ? new Request("http://localhost/api/mcp-tokens", { method: "POST", body })
      : new Request("http://localhost/api/mcp-tokens", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

function makeRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: "tok-1",
    user_id: "u1",
    label: "Claude Desktop",
    token_hash: "SHOULD_NEVER_LEAK_TOKEN_HASH",
    created_at: "2026-07-11T00:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  process.env.MCP_TOKEN_HASH_SECRET = "unit-test-secret-do-not-use-in-prod";
});

afterEach(restoreSecret);

describe("GET /api/mcp-tokens", () => {
  it("401 without a session", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const res = await getTokens();
    expect(res.status).toBe(401);
  });

  it("never returns token_hash, even if the query brought it back", async () => {
    const supabase = createFakeSupabase({ rows: [makeRow()] });
    mockUser(supabase);
    const res = await getTokens();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("SHOULD_NEVER_LEAK_TOKEN_HASH");
    expect(json.tokens[0]).not.toHaveProperty("token_hash");
  });

  it("includes both active and revoked tokens, in the order the query returns them", async () => {
    const rows = [
      makeRow({ id: "active-1", revoked_at: null }),
      makeRow({ id: "revoked-1", revoked_at: "2026-07-05T00:00:00.000Z" }),
    ];
    const supabase = createFakeSupabase({ rows });
    mockUser(supabase);
    const res = await getTokens();
    const json = await res.json();
    expect(json.tokens.map((t: { id: string }) => t.id)).toEqual(["active-1", "revoked-1"]);
  });

  it("empty array when the user has no tokens", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    mockUser(supabase);
    const res = await getTokens();
    const json = await res.json();
    expect(json.tokens).toEqual([]);
  });
});

describe("POST /api/mcp-tokens — auth and validation", () => {
  it("401 without a session", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const res = await postTokens({ label: "x" });
    expect(res.status).toBe(401);
  });

  it("400 with a non-JSON body", async () => {
    mockUser(createFakeSupabase({}));
    const res = await postTokens("not-json");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mcp-tokens — creation", () => {
  it("creates the token, returns it exactly ONCE, and the insert payload never contains the raw token", async () => {
    const supabase = createFakeSupabase({
      insertResult: {
        data: { id: "tok-1", label: "Claude Desktop", created_at: "2026-07-11T00:00:00.000Z" },
        error: null,
      },
    });
    mockUser(supabase);

    const res = await postTokens({ label: "Claude Desktop" });
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json).toMatchObject({ id: "tok-1", label: "Claude Desktop", created_at: "2026-07-11T00:00:00.000Z" });
    expect(typeof json.token).toBe("string");
    expect(json.token).toMatch(/^mcpt_/);

    expect(supabase.insertCalls).toHaveLength(1);
    const payload = supabase.insertCalls[0];
    expect(payload).toMatchObject({ user_id: "u1", label: "Claude Desktop" });
    expect(payload.token_hash).toBeTruthy();
    expect(payload.token_hash).not.toBe(json.token);
    // The raw token never travels inside the insert payload (neither as a field nor as a substring of another field).
    expect(JSON.stringify(payload)).not.toContain(json.token);
  });

  it("defaults to 'MCP client' when no label is sent", async () => {
    const supabase = createFakeSupabase({
      insertResult: { data: { id: "tok-1", label: "MCP client", created_at: "2026-07-11T00:00:00.000Z" }, error: null },
    });
    mockUser(supabase);
    await postTokens({});
    expect(supabase.insertCalls[0].label).toBe("MCP client");
  });

  it("defaults to 'MCP client' when the label is only whitespace", async () => {
    const supabase = createFakeSupabase({
      insertResult: { data: { id: "tok-1", label: "MCP client", created_at: "2026-07-11T00:00:00.000Z" }, error: null },
    });
    mockUser(supabase);
    await postTokens({ label: "   " });
    expect(supabase.insertCalls[0].label).toBe("MCP client");
  });

  it("truncates an overlong label to 100 characters", async () => {
    const supabase = createFakeSupabase({
      insertResult: { data: { id: "tok-1", label: "x".repeat(100), created_at: "2026-07-11T00:00:00.000Z" }, error: null },
    });
    mockUser(supabase);
    await postTokens({ label: "x".repeat(500) });
    expect((supabase.insertCalls[0].label as string).length).toBe(100);
  });

  it("400 with Spanish copy when the limit trigger rejects the insert", async () => {
    const supabase = createFakeSupabase({
      insertResult: {
        data: null,
        error: {
          message: "error: mcp_token_limit_reached (PL/pgSQL function enforce_mcp_token_limit() line 10 at RAISE)",
        },
      },
    });
    mockUser(supabase);
    const res = await postTokens({ label: "x" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/máximo/i);
    expect(JSON.stringify(json)).not.toContain("PL/pgSQL");
    expect(JSON.stringify(json)).not.toContain("mcp_token_limit_reached");
  });

  it("500 on a real insert error (does not disguise it as a 400)", async () => {
    const supabase = createFakeSupabase({ insertResult: { data: null, error: { message: "connection reset" } } });
    mockUser(supabase);
    const res = await postTokens({ label: "x" });
    expect(res.status).toBe(500);
  });
});
