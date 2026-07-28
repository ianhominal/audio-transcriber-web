import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetSchemaCompatCacheForTests } from "@/lib/supabase/schema-compat";

// `getApiUser` does real I/O (cookies/JWT) — mocked to inject a fixed user and a fake Supabase
// client controlled per test, same approach as `push/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { GET } from "./route";

type QueryState = { table: string; columns?: string };
type QueryResult = { data?: unknown; error?: unknown };

/** Postgres error for a column that is not in the schema (see `isMissingColumnError`). */
const MISSING_COLUMN_ERROR = { code: "42703", message: 'column "version" does not exist' };

function createMockSupabase(resolver: (state: QueryState) => QueryResult, calls: QueryState[]) {
  return {
    from(table: string) {
      const state: QueryState = { table };
      const builder = {
        select(columns?: string) {
          state.columns = columns;
          return builder;
        },
        eq: () => builder,
        gt: () => builder,
        then(resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) {
          calls.push(state);
          return Promise.resolve(resolver(state)).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/audio" }, error: null }),
      }),
    },
  };
}

const PROJECT_ROW = {
  id: "p1",
  name: "General",
  icon: "",
  description: "",
  parent_project_id: null,
  sync_origin: "local",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  deleted_at: null,
};

const TRANSCRIPTION_ROW = {
  id: "t1",
  project_id: "p1",
  title: "Nota",
  audio_name: "nota.wav",
  audio_size: 10,
  audio_url: null,
  text: "hola",
  description: "",
  icon: "",
  language: "es",
  model: "",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  deleted_at: null,
};

function setupUser(resolver: (state: QueryState) => QueryResult, calls: QueryState[]) {
  vi.mocked(getApiUser).mockResolvedValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: createMockSupabase(resolver, calls) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: { id: "u1" } as any,
  });
}

/** The route reads `req.nextUrl.searchParams`, which only exists on `NextRequest` — a plain
 * `Request` would throw and be swallowed by the route's catch-all 500. */
function request(since?: string) {
  const url = new URL("https://app.example/api/sync/pull");
  if (since) url.searchParams.set("since", since);
  return { nextUrl: url } as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/sync/pull — expand/contract for the `version` column", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSchemaCompatCacheForTests();
  });

  it("returns the server-assigned `version` when the column exists", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({
        data: s.table === "projects" ? [{ ...PROJECT_ROW, version: 7 }] : [{ ...TRANSCRIPTION_ROW, version: 4 }],
        error: null,
      }),
      calls
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects[0].version).toBe(7);
    expect(body.transcriptions[0].version).toBe(4);
  });

  /**
   * Regression guard. The migration that adds `version` is applied by the Supabase↔GitHub
   * integration, which sometimes does not run (see gotcha #8 in CLAUDE.md). If the reduced
   * fallback also asked for `version`, it would fail for the very reason the full query failed and
   * the entire pull would 500 — breaking sync for every user until the migration is applied by hand.
   */
  it("degrades instead of failing when the `version` column is missing", async () => {
    const calls: QueryState[] = [];
    setupUser((s) => {
      if (s.columns?.includes("version")) return { data: null, error: MISSING_COLUMN_ERROR };
      return { data: s.table === "projects" ? [PROJECT_ROW] : [TRANSCRIPTION_ROW], error: null };
    }, calls);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.transcriptions).toHaveLength(1);
  });

  it("defaults `version` to 1 in degraded mode so the client never sees an absent field", async () => {
    const calls: QueryState[] = [];
    setupUser((s) => {
      if (s.columns?.includes("version")) return { data: null, error: MISSING_COLUMN_ERROR };
      return { data: s.table === "projects" ? [PROJECT_ROW] : [TRANSCRIPTION_ROW], error: null };
    }, calls);

    const body = await (await GET(request())).json();

    expect(body.projects[0].version).toBe(1);
    expect(body.transcriptions[0].version).toBe(1);
  });

  it("never requests `version` in either reduced column list", async () => {
    const calls: QueryState[] = [];
    setupUser((s) => {
      if (s.columns?.includes("version")) return { data: null, error: MISSING_COLUMN_ERROR };
      return { data: s.table === "projects" ? [PROJECT_ROW] : [TRANSCRIPTION_ROW], error: null };
    }, calls);

    await GET(request());

    const retries = calls.filter((c) => !c.columns?.includes("version"));
    expect(retries.length).toBeGreaterThanOrEqual(2); // one per table
    for (const retry of retries) expect(retry.columns).not.toContain("version");
  });

  it("propagates a non-schema error as a 500 instead of silently degrading", async () => {
    const calls: QueryState[] = [];
    setupUser(() => ({ data: null, error: { code: "08006", message: "connection failure" } }), calls);

    const res = await GET(request());

    expect(res.status).toBe(500);
  });
});
