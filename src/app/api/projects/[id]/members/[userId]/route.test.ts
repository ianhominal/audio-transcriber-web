import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/api", () => ({ getApiUser: vi.fn() }));
vi.mock("@/lib/members/store", () => ({
  getProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { getProjectMember, updateProjectMemberRole, removeProjectMember } from "@/lib/members/store";
import { PATCH, DELETE } from "./route";

function mockSession(callerId: string | null, rpcResult: { data?: unknown; error?: unknown } = { data: true, error: null }) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: { rpc: vi.fn().mockResolvedValue(rpcResult) } as never,
    user: callerId ? ({ id: callerId } as never) : null,
  });
}

function patchReq(body: unknown, projectId = "p1", targetUserId = "u2") {
  return PATCH(
    new Request(`http://localhost/api/projects/${projectId}/members/${targetUserId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: projectId, userId: targetUserId }) }
  );
}

function deleteReq(projectId = "p1", targetUserId = "u2") {
  return DELETE(new Request(`http://localhost/api/projects/${projectId}/members/${targetUserId}`, { method: "DELETE" }) as never, {
    params: Promise.resolve({ id: projectId, userId: targetUserId }),
  });
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(getProjectMember).mockReset();
  vi.mocked(updateProjectMemberRole).mockReset();
  vi.mocked(removeProjectMember).mockReset();
});

describe("PATCH /api/projects/[id]/members/[userId]", () => {
  it("401 without a session", async () => {
    mockSession(null);
    expect((await patchReq({ role: "admin" })).status).toBe(401);
  });

  it("400 on an invalid role", async () => {
    mockSession("u1");
    expect((await patchReq({ role: "owner" })).status).toBe(400);
  });

  it("403 when the caller lacks 'share'", async () => {
    mockSession("u1", { data: false, error: null });
    const res = await patchReq({ role: "admin" });
    expect(res.status).toBe(403);
    expect(getProjectMember).not.toHaveBeenCalled();
  });

  it("404 when the target isn't a member of the project", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue(null);
    const res = await patchReq({ role: "admin" });
    expect(res.status).toBe(404);
    expect(updateProjectMemberRole).not.toHaveBeenCalled();
  });

  it("403 with a clear message when trying to change the owner's role", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "owner", granted_by: "u1", created_at: "now" });
    const res = await patchReq({ role: "admin" });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("No se puede cambiar el rol del dueño del proyecto.");
    expect(updateProjectMemberRole).not.toHaveBeenCalled();
  });

  it("403 when a caller tries to promote themselves", async () => {
    mockSession("u2");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "editor", granted_by: "u1", created_at: "now" });
    const res = await patchReq({ role: "admin" }, "p1", "u2");
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("No podés subirte el rol a vos mismo.");
    expect(updateProjectMemberRole).not.toHaveBeenCalled();
  });

  it("200 on a successful role change", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "editor", granted_by: "u1", created_at: "now" });
    vi.mocked(updateProjectMemberRole).mockResolvedValue({
      ok: true,
      member: { project_id: "p1", user_id: "u2", role: "admin", granted_by: "u1", created_at: "now" },
    });
    const res = await patchReq({ role: "admin" });
    expect(res.status).toBe(200);
  });

  it("403 when the store reports owner_protected (race between the read and the write)", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "editor", granted_by: "u1", created_at: "now" });
    vi.mocked(updateProjectMemberRole).mockResolvedValue({ ok: false, error: "x", code: "owner_protected" });
    const res = await patchReq({ role: "admin" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/projects/[id]/members/[userId]", () => {
  it("401 without a session", async () => {
    mockSession(null);
    expect((await deleteReq()).status).toBe(401);
  });

  it("403 when the caller lacks 'share'", async () => {
    mockSession("u1", { data: false, error: null });
    expect((await deleteReq()).status).toBe(403);
  });

  it("404 when the target isn't a member", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue(null);
    expect((await deleteReq()).status).toBe(404);
  });

  it("403 with a clear message when trying to remove the owner", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "owner", granted_by: "u1", created_at: "now" });
    const res = await deleteReq();
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("No se puede quitar al dueño del proyecto.");
    expect(removeProjectMember).not.toHaveBeenCalled();
  });

  it("200 on a successful removal", async () => {
    mockSession("u1");
    vi.mocked(getProjectMember).mockResolvedValue({ project_id: "p1", user_id: "u2", role: "editor", granted_by: "u1", created_at: "now" });
    vi.mocked(removeProjectMember).mockResolvedValue({ ok: true });
    expect((await deleteReq()).status).toBe(200);
  });
});
