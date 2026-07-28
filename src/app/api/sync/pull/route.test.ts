import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetSchemaCompatCacheForTests } from "@/lib/supabase/schema-compat";

// `getApiUser` does real I/O (cookies/JWT) — mocked to inject a fixed user and a fake Supabase
// client controlled per test, same approach as `push/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { GET } from "./route";

type QueryState = { table: string; columns?: string; eqCalls: Array<[string, unknown]> };
type QueryResult = { data?: unknown; error?: unknown };

/** Postgres error for a column that is not in the schema (see `isMissingColumnError`). */
const MISSING_COLUMN_ERROR = { code: "42703", message: 'column "version" does not exist' };

function createMockSupabase(resolver: (state: QueryState) => QueryResult, calls: QueryState[]) {
  return {
    from(table: string) {
      const state: QueryState = { table, eqCalls: [] };
      const builder = {
        select(columns?: string) {
          state.columns = columns;
          return builder;
        },
        // Records every `.eq(col, val)` call so Phase 13 tests can assert NO manual `user_id`
        // filter is ever sent for `projects`/`transcriptions` — the RLS policies
        // (`20260728160000_rls_projects_transcriptions.sql`) are the only thing allowed to decide
        // that anymore (CRÍTICO-2). `resolveMemberCountsByProject` uses `.in()`, not `.eq()`, so
        // this never has to special-case that call.
        eq(col: string, val: unknown) {
          state.eqCalls.push([col, val]);
          return builder;
        },
        gt: () => builder,
        // Used by `resolveMemberCountsByProject` (Phase 11, audio_state) — not by the
        // projects/transcriptions fetches above, which only ever use `eq`/`gt`.
        in: () => builder,
        then(resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) {
          calls.push(state);
          return Promise.resolve(resolver(state)).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from: () => ({
        createSignedUrl: (...args: unknown[]) => {
          signedUrlCalls.push(args);
          return Promise.resolve({ data: { signedUrl: "https://signed.example/audio" }, error: null });
        },
      }),
    },
  };
}

/** Args passed to `createSignedUrl` across the whole test file — reset in `beforeEach`. Module-
 * level on purpose: `createMockSupabase` is a factory called fresh per test via `setupUser`. */
let signedUrlCalls: unknown[][] = [];

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
    signedUrlCalls = [];
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

describe("GET /api/sync/pull — Team Sharing slice 1b Phase 12: signed URL TTL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSchemaCompatCacheForTests();
    signedUrlCalls = [];
  });

  it("requests a 600s TTL for the audio signed URL, not 3600s", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({ data: s.table === "projects" ? [PROJECT_ROW] : [{ ...TRANSCRIPTION_ROW, audio_url: "u1/a.wav" }], error: null }),
      calls
    );

    await GET(request());

    expect(signedUrlCalls).toHaveLength(1);
    expect(signedUrlCalls[0][1]).toBe(600);
  });
});

describe("GET /api/sync/pull — Team Sharing slice 1b Phase 11: audio_state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSchemaCompatCacheForTests();
    signedUrlCalls = [];
  });

  it("is 'available' when audio_url is present", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({ data: s.table === "projects" ? [PROJECT_ROW] : [{ ...TRANSCRIPTION_ROW, audio_url: "u1/a.wav" }], error: null }),
      calls
    );

    const body = await (await GET(request())).json();

    expect(body.transcriptions[0].audio_state).toBe("available");
  });

  it("is 'unavailable' without audio_url when member-count resolution degrades to 1 (Phase 1/2 not applied)", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({ data: s.table === "projects" ? [PROJECT_ROW] : [TRANSCRIPTION_ROW], error: null }),
      calls
    );

    const body = await (await GET(request())).json();

    expect(body.transcriptions[0].audio_state).toBe("unavailable");
  });
});

describe("GET /api/sync/pull — Team Sharing slice 1b Phase 13 (CRÍTICO-2): RLS is the only filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSchemaCompatCacheForTests();
    signedUrlCalls = [];
  });

  it("never sends a manual .eq('user_id', ...) filter on projects or transcriptions — RLS decides", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({ data: s.table === "projects" ? [PROJECT_ROW] : [TRANSCRIPTION_ROW], error: null }),
      calls
    );

    await GET(request());

    const projectsCall = calls.find((c) => c.table === "projects");
    const transcriptionsCall = calls.find((c) => c.table === "transcriptions");
    expect(projectsCall?.eqCalls.some(([col]) => col === "user_id")).toBe(false);
    expect(transcriptionsCall?.eqCalls.some(([col]) => col === "user_id")).toBe(false);
  });

  it("passes through rows the RLS returned even though they were not created by the authenticated user", async () => {
    // Simulates exactly what the RLS itself hands back for a viewer: rows owned by a different
    // account, visible only through `has_root_access`/`has_project_access` on a shared project.
    // The spec's own escenario: "El pull de un viewer trae lo compartido, no solo lo propio" — the
    // route must NOT re-filter these out with a code-level `user_id` check.
    const calls: QueryState[] = [];
    const SHARED_PROJECT = { ...PROJECT_ROW, id: "p-shared" };
    const SHARED_TRANSCRIPTION = { ...TRANSCRIPTION_ROW, id: "t-shared", project_id: "p-shared" };
    setupUser(
      (s) => ({ data: s.table === "projects" ? [SHARED_PROJECT] : [SHARED_TRANSCRIPTION], error: null }),
      calls
    );

    const body = await (await GET(request())).json();

    expect(body.projects.map((p: { id: string }) => p.id)).toContain("p-shared");
    expect(body.transcriptions.map((t: { id: string }) => t.id)).toContain("t-shared");
  });

  it("a transcription with project_id null (private note) still round-trips normally — RLS keeps it private on its own", async () => {
    const calls: QueryState[] = [];
    setupUser(
      (s) => ({
        data: s.table === "projects" ? [PROJECT_ROW] : [{ ...TRANSCRIPTION_ROW, project_id: null }],
        error: null,
      }),
      calls
    );

    const body = await (await GET(request())).json();

    expect(body.transcriptions[0].project_id).toBeNull();
  });
});
