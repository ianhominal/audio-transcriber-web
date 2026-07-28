import { describe, it, expect } from "vitest";
import {
  resolveUserIdByEmail,
  createInvite,
  listSentInvites,
  listReceivedInvites,
  acceptInvite,
  rejectInvite,
  cancelInvite,
} from "./store";

const MISSING_TABLE_ERROR = { code: "42P01", message: 'relation "project_invites" does not exist' };
const MISSING_FUNCTION_ERROR = { code: "42883", message: "function accept_project_invite(uuid) does not exist" };
const DUPLICATE_ERROR = { code: "23505", message: "duplicate key value violates unique constraint" };

// ---------- resolveUserIdByEmail ----------

function fakeProfilesClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      };
    },
  };
}

describe("resolveUserIdByEmail", () => {
  it("returns the user id when an account exists", async () => {
    const result = await resolveUserIdByEmail(
      fakeProfilesClient({ data: { id: "u1" }, error: null }) as never,
      "someone@example.com"
    );
    expect(result).toEqual({ ok: true, userId: "u1" });
  });

  it("returns not_found without creating anything when there is no account", async () => {
    const result = await resolveUserIdByEmail(
      fakeProfilesClient({ data: null, error: null }) as never,
      "nobody@example.com"
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("not_found");
  });

  it("returns server_error on an unexpected DB error", async () => {
    const result = await resolveUserIdByEmail(
      fakeProfilesClient({ data: null, error: { message: "connection failure" } }) as never,
      "someone@example.com"
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("server_error");
  });
});

// ---------- createInvite ----------

function fakeInvitesInsertClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_invites") throw new Error(`unexpected table: ${table}`);
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve(result),
          }),
        }),
      };
    },
  };
}

describe("createInvite", () => {
  const params = { projectId: "p1", invitedUserId: "u2", role: "viewer" as const, invitedBy: "u1" };

  it("inserts and returns the pending invite", async () => {
    const row = { id: "inv1", project_id: "p1", invited_user_id: "u2", role: "viewer", invited_by: "u1", status: "pending", created_at: "now", resolved_at: null };
    const result = await createInvite(fakeInvitesInsertClient({ data: row, error: null }) as never, params);
    expect(result).toEqual({ ok: true, invite: row });
  });

  it("maps a unique-violation to a 'duplicate' error, not a generic 500", async () => {
    const result = await createInvite(fakeInvitesInsertClient({ data: null, error: DUPLICATE_ERROR }) as never, params);
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("duplicate");
  });

  it("degrades to 'not_ready' when `project_invites` does not exist yet", async () => {
    const result = await createInvite(fakeInvitesInsertClient({ data: null, error: MISSING_TABLE_ERROR }) as never, params);
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("not_ready");
  });
});

// ---------- listSentInvites / listReceivedInvites ----------

function fakeInvitesListClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_invites") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => Promise.resolve(result),
            }),
          }),
        }),
      };
    },
  };
}

describe("listSentInvites / listReceivedInvites", () => {
  it("returns the pending rows on success", async () => {
    const rows = [{ id: "inv1" }];
    expect(await listSentInvites(fakeInvitesListClient({ data: rows, error: null }) as never, "p1")).toEqual(rows);
    expect(await listReceivedInvites(fakeInvitesListClient({ data: rows, error: null }) as never, "u1")).toEqual(rows);
  });

  it("degrades to an empty list instead of 500 when the table is missing", async () => {
    expect(await listSentInvites(fakeInvitesListClient({ data: null, error: MISSING_TABLE_ERROR }) as never, "p1")).toEqual([]);
    expect(await listReceivedInvites(fakeInvitesListClient({ data: null, error: MISSING_TABLE_ERROR }) as never, "u1")).toEqual([]);
  });
});

// ---------- acceptInvite ----------

function fakeRpcClient(result: { error?: unknown }) {
  return { rpc: () => Promise.resolve(result) };
}

describe("acceptInvite", () => {
  it("succeeds when the RPC succeeds", async () => {
    const result = await acceptInvite(fakeRpcClient({ error: null }) as never, "inv1");
    expect(result).toEqual({ ok: true });
  });

  it("returns not_found for the RPC's uniform rejection (not found / not mine / not pending)", async () => {
    const result = await acceptInvite(fakeRpcClient({ error: { message: "invite not found or not pending" } }) as never, "inv1");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("not_found");
  });

  it("degrades cleanly when the RPC is not deployed yet", async () => {
    const result = await acceptInvite(fakeRpcClient({ error: MISSING_FUNCTION_ERROR }) as never, "inv1");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("server_error");
  });
});

// ---------- rejectInvite / cancelInvite ----------

function fakeUpdateClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_invites") throw new Error(`unexpected table: ${table}`);
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve(result),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

function fakeDeleteClient(result: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== "project_invites") throw new Error(`unexpected table: ${table}`);
      return {
        delete: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve(result),
            }),
          }),
        }),
      };
    },
  };
}

describe("rejectInvite", () => {
  it("succeeds when a matching pending row is updated", async () => {
    const result = await rejectInvite(fakeUpdateClient({ data: { id: "inv1" }, error: null }) as never, "inv1", "u1");
    expect(result).toEqual({ ok: true });
  });

  it("returns not_found when no row matched (wrong owner, already resolved, or missing)", async () => {
    const result = await rejectInvite(fakeUpdateClient({ data: null, error: null }) as never, "inv1", "u1");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("not_found");
  });
});

describe("cancelInvite", () => {
  it("succeeds when a row is deleted", async () => {
    const result = await cancelInvite(fakeDeleteClient({ data: { id: "inv1" }, error: null }) as never, "inv1");
    expect(result).toEqual({ ok: true });
  });

  it("returns not_found when RLS blocks the delete (not pending, not the inviter/share holder)", async () => {
    const result = await cancelInvite(fakeDeleteClient({ data: null, error: null }) as never, "inv1");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("not_found");
  });
});
