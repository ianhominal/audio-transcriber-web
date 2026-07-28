import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/api", () => ({ getApiUser: vi.fn() }));
vi.mock("@/lib/supabase/serviceRole", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/members/store", () => ({ listProjectMembers: vi.fn() }));
vi.mock("@/lib/invites/store", () => ({ resolveUserIdByEmail: vi.fn(), createInvite: vi.fn() }));

import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { listProjectMembers } from "@/lib/members/store";
import { resolveUserIdByEmail, createInvite } from "@/lib/invites/store";
import { GET, POST } from "./route";

function mockSession(userId: string | null, rpcResult: { data?: unknown; error?: unknown } = { data: true, error: null }) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: { rpc: vi.fn().mockResolvedValue(rpcResult) } as never,
    user: userId ? ({ id: userId } as never) : null,
  });
}

function getReq(projectId = "p1") {
  return GET(new Request(`http://localhost/api/projects/${projectId}/members`) as never, {
    params: Promise.resolve({ id: projectId }),
  });
}

function postReq(body: unknown, projectId = "p1") {
  return POST(
    new Request(`http://localhost/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: projectId }) }
  );
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
  vi.mocked(listProjectMembers).mockReset();
  vi.mocked(resolveUserIdByEmail).mockReset();
  vi.mocked(createInvite).mockReset();
});

describe("GET /api/projects/[id]/members", () => {
  it("401 without a session", async () => {
    mockSession(null);
    const res = await getReq();
    expect(res.status).toBe(401);
  });

  it("200 with the member list (RLS is the only filter, no capability re-check)", async () => {
    mockSession("u1");
    vi.mocked(listProjectMembers).mockResolvedValue([
      { project_id: "p1", user_id: "u1", role: "owner", granted_by: "u1", created_at: "now" },
    ]);
    const res = await getReq();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(1);
  });
});

describe("POST /api/projects/[id]/members", () => {
  it("401 without a session", async () => {
    mockSession(null);
    const res = await postReq({ email: "a@b.com", role: "viewer" });
    expect(res.status).toBe(401);
  });

  it("400 on an invalid email", async () => {
    mockSession("u1");
    const res = await postReq({ email: "not-an-email", role: "viewer" });
    expect(res.status).toBe(400);
  });

  it("400 on an invalid role", async () => {
    mockSession("u1");
    const res = await postReq({ email: "a@b.com", role: "owner" });
    expect(res.status).toBe(400);
  });

  it("403 when the caller lacks 'share' — checked explicitly, not just left to RLS (I-8)", async () => {
    mockSession("u1", { data: false, error: null });
    const res = await postReq({ email: "a@b.com", role: "viewer" });
    expect(res.status).toBe(403);
    expect(resolveUserIdByEmail).not.toHaveBeenCalled();
  });

  it("404 when the email has no existing account — no invite created", async () => {
    mockSession("u1");
    vi.mocked(resolveUserIdByEmail).mockResolvedValue({
      ok: false,
      error: "Esa persona todavía no tiene una cuenta en el producto.",
      code: "not_found",
    });
    const res = await postReq({ email: "nobody@example.com", role: "viewer" });
    expect(res.status).toBe(404);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("201 on success", async () => {
    mockSession("u1");
    vi.mocked(resolveUserIdByEmail).mockResolvedValue({ ok: true, userId: "u2" });
    vi.mocked(createInvite).mockResolvedValue({
      ok: true,
      invite: {
        id: "inv1",
        project_id: "p1",
        invited_user_id: "u2",
        role: "viewer",
        invited_by: "u1",
        status: "pending",
        created_at: "now",
        resolved_at: null,
      },
    });
    const res = await postReq({ email: "a@b.com", role: "viewer" });
    expect(res.status).toBe(201);
  });
});
