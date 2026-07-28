import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/api", () => ({ getApiUser: vi.fn() }));

import { getApiUser } from "@/lib/supabase/api";
import { GET } from "./route";

type Result = { data?: unknown; error?: unknown };

const MISSING_COLUMN_ERROR = { code: "42703", message: 'column "root_project_id" does not exist' };
const MISSING_TABLE_ERROR = { code: "42P01", message: 'relation "transcriptions" does not exist' };

function createFakeSupabase(opts: { project: Result; subtree?: Result; transcriptions: Result }) {
  return {
    from(table: string) {
      if (table === "projects") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => Promise.resolve(opts.project),
                  then: (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
                    Promise.resolve(opts.subtree ?? { data: [], error: null }).then(resolve, reject),
                };
              },
            };
          },
        };
      }
      if (table === "transcriptions") {
        return {
          select() {
            return {
              in() {
                return {
                  is() {
                    return { is: () => Promise.resolve(opts.transcriptions) };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function mockSession(userId: string | null, opts: Parameters<typeof createFakeSupabase>[0]) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: createFakeSupabase(opts) as never,
    user: userId ? ({ id: userId } as never) : null,
  });
}

function request(id = "p1") {
  return GET(new Request(`http://localhost/api/projects/${id}/share-readiness`) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
});

describe("GET /api/projects/[id]/share-readiness", () => {
  it("401 without a session", async () => {
    mockSession(null, { project: { data: null, error: null }, transcriptions: { data: [], error: null } });
    expect((await request()).status).toBe(401);
  });

  it("404 when RLS hides the project (no read access)", async () => {
    mockSession("u1", { project: { data: null, error: null }, transcriptions: { data: [], error: null } });
    expect((await request()).status).toBe(404);
  });

  it("spec 'El owner ve las notas sin audio antes de compartir': 3 missing → count 3 + items", async () => {
    mockSession("u1", {
      project: { data: { id: "p1", root_project_id: "p1" }, error: null },
      subtree: { data: [{ id: "p1" }], error: null },
      transcriptions: {
        data: [
          { id: "t1", audio_name: "a.wav", project_id: "p1", audio_url: null, deleted_at: null },
          { id: "t2", audio_name: "b.wav", project_id: "p1", audio_url: null, deleted_at: null },
          { id: "t3", audio_name: "c.wav", project_id: "p1", audio_url: null, deleted_at: null },
        ],
        error: null,
      },
    });
    const body = await (await request()).json();
    expect(body.missingAudioCount).toBe(3);
    expect(body.items).toHaveLength(3);
  });

  it("spec 'Un proyecto con todo el audio en la nube reporta cero faltantes'", async () => {
    mockSession("u1", {
      project: { data: { id: "p1", root_project_id: "p1" }, error: null },
      subtree: { data: [{ id: "p1" }], error: null },
      transcriptions: { data: [], error: null },
    });
    const body = await (await request()).json();
    expect(body).toEqual({ missingAudioCount: 0, items: [] });
  });

  it("degrades to single-project scope (never a 500) when root_project_id is missing (Phase 1 not applied)", async () => {
    mockSession("u1", {
      project: { data: null, error: MISSING_COLUMN_ERROR },
      transcriptions: {
        data: [{ id: "t1", audio_name: "a.wav", project_id: "p1", audio_url: null, deleted_at: null }],
        error: null,
      },
    });
    const res = await request();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.missingAudioCount).toBe(1);
  });

  it("returns zero-faltantes (not a 500) when `transcriptions` degrades via a missing-table error", async () => {
    mockSession("u1", {
      project: { data: { id: "p1", root_project_id: "p1" }, error: null },
      subtree: { data: [{ id: "p1" }], error: null },
      transcriptions: { data: null, error: MISSING_TABLE_ERROR },
    });
    const res = await request();
    expect(res.status).toBe(200);
    expect((await res.json()).missingAudioCount).toBe(0);
  });
});
