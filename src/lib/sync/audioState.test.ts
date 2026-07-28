import { describe, it, expect } from "vitest";
import { computeAudioState, resolveMemberCountsByProject } from "./audioState";

describe("computeAudioState", () => {
  it("is 'available' whenever audio_url is present, regardless of member count", () => {
    expect(computeAudioState("audios/a.wav", 1)).toBe("available");
    expect(computeAudioState("audios/a.wav", 5)).toBe("available");
  });

  it("is 'pending_upload' without audio_url when the project has more than one member", () => {
    expect(computeAudioState(null, 2)).toBe("pending_upload");
    expect(computeAudioState(undefined, 3)).toBe("pending_upload");
  });

  it("is 'unavailable' without audio_url when the project has one member (or none resolved)", () => {
    expect(computeAudioState(null, 1)).toBe("unavailable");
    expect(computeAudioState(null, 0)).toBe("unavailable");
  });

  it("treats an empty string audio_url as absent", () => {
    expect(computeAudioState("", 2)).toBe("pending_upload");
  });
});

type QueryResult = { data?: unknown; error?: unknown };

/** Minimal fake: only supports `.select().in()` (the sole chain this module uses), and records
 * which tables/ids were queried so tests can assert the two-query shape without over-mocking. */
function createFakeSupabase(
  resolver: (table: string, ids: string[]) => QueryResult,
  calls: Array<{ table: string; ids: string[] }> = []
) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              calls.push({ table, ids: [...ids] });
              return Promise.resolve(resolver(table, ids));
            },
          };
        },
      };
    },
  };
}

describe("resolveMemberCountsByProject", () => {
  it("returns an empty map without querying anything for an empty/null-only input", async () => {
    const calls: Array<{ table: string; ids: string[] }> = [];
    const supabase = createFakeSupabase(() => ({ data: [], error: null }), calls);

    const result = await resolveMemberCountsByProject(supabase as never, [null, undefined]);

    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("counts members grouped by the resolved root, keyed by the original project id", async () => {
    const supabase = createFakeSupabase((table) => {
      if (table === "projects") {
        return {
          data: [
            { id: "child-1", root_project_id: "root-A" },
            { id: "child-2", root_project_id: "root-A" },
          ],
          error: null,
        };
      }
      // project_members, queried by root ids
      return {
        data: [{ project_id: "root-A" }, { project_id: "root-A" }, { project_id: "root-A" }],
        error: null,
      };
    });

    const result = await resolveMemberCountsByProject(supabase as never, ["child-1", "child-2"]);

    expect(result.get("child-1")).toBe(3);
    expect(result.get("child-2")).toBe(3);
  });

  it("degrades to memberCount=1 when `root_project_id` is missing (Phase 1 not applied yet)", async () => {
    const supabase = createFakeSupabase((table) => {
      if (table === "projects") {
        return { data: null, error: { code: "42703", message: 'column "root_project_id" does not exist' } };
      }
      return { data: [{ project_id: "p1" }], error: null };
    });

    const result = await resolveMemberCountsByProject(supabase as never, ["p1"]);

    expect(result.get("p1")).toBe(1);
  });

  it("degrades to memberCount=1 when `project_members` does not exist yet (Phase 2 not applied)", async () => {
    const supabase = createFakeSupabase((table) => {
      if (table === "projects") return { data: [{ id: "p1", root_project_id: "p1" }], error: null };
      return { data: null, error: { code: "42P01", message: 'relation "project_members" does not exist' } };
    });

    const result = await resolveMemberCountsByProject(supabase as never, ["p1"]);

    expect(result.get("p1")).toBe(1);
  });
});
