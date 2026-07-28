import { describe, it, expect } from "vitest";
import {
  listProjectMembers,
  attachMemberEmails,
  getProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
} from "./store";

const MISSING_TABLE_ERROR = { code: "42P01", message: 'relation "project_members" does not exist' };
const OWNER_DEMOTE_ERROR = { message: "the project owner cannot be demoted" };
const OWNER_REMOVE_ERROR = { message: "the project owner cannot be removed" };
const MEMBER_ROW = { project_id: "p1", user_id: "u2", role: "editor" as const, granted_by: "u1", created_at: "now" };

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

// ---------- attachMemberEmails ----------

function fakeProfilesInClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          in: () => Promise.resolve(result),
        }),
      };
    },
  };
}

describe("attachMemberEmails", () => {
  it("returns [] without querying when there are no members", async () => {
    const result = await attachMemberEmails(fakeProfilesInClient({ data: [], error: null }) as never, []);
    expect(result).toEqual([]);
  });

  it("attaches the matching email to each member", async () => {
    const result = await attachMemberEmails(
      fakeProfilesInClient({ data: [{ id: "u2", email: "a@b.com" }], error: null }) as never,
      [MEMBER_ROW]
    );
    expect(result).toEqual([{ ...MEMBER_ROW, email: "a@b.com" }]);
  });

  it("falls back to null for a member id with no match", async () => {
    const result = await attachMemberEmails(fakeProfilesInClient({ data: [], error: null }) as never, [MEMBER_ROW]);
    expect(result).toEqual([{ ...MEMBER_ROW, email: null }]);
  });

  it("degrades to null emails on a DB error, never throws", async () => {
    const result = await attachMemberEmails(
      fakeProfilesInClient({ data: null, error: { message: "connection failure" } }) as never,
      [MEMBER_ROW]
    );
    expect(result).toEqual([{ ...MEMBER_ROW, email: null }]);
  });
});

// ---------- getProjectMember ----------

function fakeGetMemberClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_members") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(result),
            }),
          }),
        }),
      };
    },
  };
}

describe("getProjectMember", () => {
  it("returns the row when it exists", async () => {
    const result = await getProjectMember(fakeGetMemberClient({ data: MEMBER_ROW, error: null }) as never, "p1", "u2");
    expect(result).toEqual(MEMBER_ROW);
  });

  it("returns null when the target isn't a member", async () => {
    const result = await getProjectMember(fakeGetMemberClient({ data: null, error: null }) as never, "p1", "u2");
    expect(result).toBeNull();
  });

  it("returns null instead of throwing on an unexpected error", async () => {
    const result = await getProjectMember(
      fakeGetMemberClient({ data: null, error: { message: "connection failure" } }) as never,
      "p1",
      "u2"
    );
    expect(result).toBeNull();
  });
});

// ---------- updateProjectMemberRole ----------

function fakeUpdateRoleClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_members") throw new Error(`unexpected table: ${table}`);
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve(result),
              }),
            }),
          }),
        }),
      };
    },
  };
}

describe("updateProjectMemberRole", () => {
  it("updates and returns the new row on success", async () => {
    const updated = { ...MEMBER_ROW, role: "admin" };
    const result = await updateProjectMemberRole(fakeUpdateRoleClient({ data: updated, error: null }) as never, "p1", "u2", "admin");
    expect(result).toEqual({ ok: true, member: updated });
  });

  it("returns not_found when no row matched (RLS blocked it, or the target isn't a member)", async () => {
    const result = await updateProjectMemberRole(fakeUpdateRoleClient({ data: null, error: null }) as never, "p1", "u2", "admin");
    expect(result).toEqual({ ok: false, error: "No encontramos a esa persona en este proyecto.", code: "not_found" });
  });

  it("maps the owner-protection trigger to a clear message instead of a 500", async () => {
    const result = await updateProjectMemberRole(
      fakeUpdateRoleClient({ data: null, error: OWNER_DEMOTE_ERROR }) as never,
      "p1",
      "u2",
      "admin"
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("owner_protected");
  });

  it("degrades to not_ready when the table is missing", async () => {
    const result = await updateProjectMemberRole(
      fakeUpdateRoleClient({ data: null, error: MISSING_TABLE_ERROR }) as never,
      "p1",
      "u2",
      "admin"
    );
    expect(result).toEqual({ ok: false, error: "Gestionar miembros todavía no está disponible.", code: "not_ready" });
  });
});

// ---------- removeProjectMember ----------

function fakeRemoveMemberClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_members") throw new Error(`unexpected table: ${table}`);
      return {
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve(result),
              }),
            }),
          }),
        }),
      };
    },
  };
}

describe("removeProjectMember", () => {
  it("succeeds when a matching row is deleted", async () => {
    const result = await removeProjectMember(fakeRemoveMemberClient({ data: { user_id: "u2" }, error: null }) as never, "p1", "u2");
    expect(result).toEqual({ ok: true });
  });

  it("returns not_found when no row matched", async () => {
    const result = await removeProjectMember(fakeRemoveMemberClient({ data: null, error: null }) as never, "p1", "u2");
    expect(result).toEqual({ ok: false, error: "No encontramos a esa persona en este proyecto.", code: "not_found" });
  });

  it("maps the owner-protection trigger to a clear message instead of a 500", async () => {
    const result = await removeProjectMember(fakeRemoveMemberClient({ data: null, error: OWNER_REMOVE_ERROR }) as never, "p1", "u2");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("owner_protected");
  });
});
