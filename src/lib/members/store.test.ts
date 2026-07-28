import { describe, it, expect } from "vitest";
import { listProjectMembers } from "./store";

const MISSING_TABLE_ERROR = { code: "42P01", message: 'relation "project_members" does not exist' };

function fakeMembersClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_members") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve(result),
          }),
        }),
      };
    },
  };
}

describe("listProjectMembers", () => {
  it("returns the member rows on success", async () => {
    const rows = [{ project_id: "p1", user_id: "u1", role: "owner", granted_by: "u1", created_at: "now" }];
    const result = await listProjectMembers(fakeMembersClient({ data: rows, error: null }) as never, "p1");
    expect(result).toEqual(rows);
  });

  it("degrades to an empty list instead of throwing when the table is missing (Phase 2 not applied)", async () => {
    const result = await listProjectMembers(fakeMembersClient({ data: null, error: MISSING_TABLE_ERROR }) as never, "p1");
    expect(result).toEqual([]);
  });

  it("degrades to an empty list on any other unexpected error too, never throws", async () => {
    const result = await listProjectMembers(
      fakeMembersClient({ data: null, error: { message: "connection failure" } }) as never,
      "p1"
    );
    expect(result).toEqual([]);
  });
});
