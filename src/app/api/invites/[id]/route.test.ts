import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/api", () => ({ getApiUser: vi.fn() }));
vi.mock("@/lib/invites/store", () => ({
  acceptInvite: vi.fn(),
  rejectInvite: vi.fn(),
  cancelInvite: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { acceptInvite, rejectInvite, cancelInvite } from "@/lib/invites/store";
import { POST, DELETE } from "./route";

function mockSession(userId: string | null) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: {} as never,
    user: userId ? ({ id: userId } as never) : null,
  });
}

function postReq(action: unknown, id = "inv1") {
  return POST(new Request(`http://localhost/api/invites/${id}`, { method: "POST", body: JSON.stringify({ action }) }) as never, {
    params: Promise.resolve({ id }),
  });
}

function deleteReq(id = "inv1") {
  return DELETE(new Request(`http://localhost/api/invites/${id}`, { method: "DELETE" }) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(acceptInvite).mockReset();
  vi.mocked(rejectInvite).mockReset();
  vi.mocked(cancelInvite).mockReset();
});

describe("POST /api/invites/[id]", () => {
  it("401 without a session", async () => {
    mockSession(null);
    expect((await postReq("accept")).status).toBe(401);
  });

  it("400 on an unknown action", async () => {
    mockSession("u1");
    expect((await postReq("delete-everything")).status).toBe(400);
  });

  it("200 on accept", async () => {
    mockSession("u1");
    vi.mocked(acceptInvite).mockResolvedValue({ ok: true });
    const res = await postReq("accept");
    expect(res.status).toBe(200);
  });

  it("404 when accept fails (not found / not mine / not pending — uniform)", async () => {
    mockSession("u1");
    vi.mocked(acceptInvite).mockResolvedValue({ ok: false, error: "x", code: "not_found" });
    expect((await postReq("accept")).status).toBe(404);
  });

  it("200 on reject", async () => {
    mockSession("u1");
    vi.mocked(rejectInvite).mockResolvedValue({ ok: true });
    const res = await postReq("reject");
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/invites/[id]", () => {
  it("401 without a session", async () => {
    mockSession(null);
    expect((await deleteReq()).status).toBe(401);
  });

  it("200 on a successful cancel", async () => {
    mockSession("u1");
    vi.mocked(cancelInvite).mockResolvedValue({ ok: true });
    expect((await deleteReq()).status).toBe(200);
  });

  it("404 when RLS blocks the cancel", async () => {
    mockSession("u1");
    vi.mocked(cancelInvite).mockResolvedValue({ ok: false, error: "x", code: "not_found" });
    expect((await deleteReq()).status).toBe(404);
  });
});
