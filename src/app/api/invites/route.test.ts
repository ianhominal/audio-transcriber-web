import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/api", () => ({ getApiUser: vi.fn() }));
vi.mock("@/lib/supabase/serviceRole", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/invites/store", () => ({
  listReceivedInvites: vi.fn(),
  listSentInvites: vi.fn(),
  attachProjectNames: vi.fn(),
  attachInviteeEmails: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { listReceivedInvites, listSentInvites, attachProjectNames, attachInviteeEmails } from "@/lib/invites/store";
import { GET } from "./route";

function mockSession(userId: string | null) {
  vi.mocked(getApiUser).mockResolvedValue({
    supabase: {} as never,
    user: userId ? ({ id: userId } as never) : null,
  });
}

function getReq(url = "http://localhost/api/invites") {
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(createServiceRoleClient).mockReset();
  vi.mocked(listReceivedInvites).mockReset();
  vi.mocked(listSentInvites).mockReset();
  vi.mocked(attachProjectNames).mockReset();
  vi.mocked(attachInviteeEmails).mockReset();
});

describe("GET /api/invites", () => {
  it("401 without a session", async () => {
    mockSession(null);
    expect((await getReq()).status).toBe(401);
  });

  it("without ?projectId, returns RECEIVED invites with project names and invitee emails attached", async () => {
    mockSession("u1");
    vi.mocked(listReceivedInvites).mockResolvedValue([{ id: "inv1" } as never]);
    vi.mocked(attachProjectNames).mockResolvedValue([{ id: "inv1", project_name: "Proyecto A" } as never]);
    vi.mocked(attachInviteeEmails).mockResolvedValue([
      { id: "inv1", project_name: "Proyecto A", invitee_email: "u1@example.com" } as never,
    ]);

    const res = await getReq();
    const body = await res.json();

    expect(listReceivedInvites).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(listSentInvites).not.toHaveBeenCalled();
    expect(body.invites).toEqual([{ id: "inv1", project_name: "Proyecto A", invitee_email: "u1@example.com" }]);
  });

  it("with ?projectId, returns SENT invites for that project", async () => {
    mockSession("u1");
    vi.mocked(listSentInvites).mockResolvedValue([{ id: "inv2" } as never]);
    vi.mocked(attachProjectNames).mockResolvedValue([{ id: "inv2", project_name: "Proyecto B" } as never]);
    vi.mocked(attachInviteeEmails).mockResolvedValue([
      { id: "inv2", project_name: "Proyecto B", invitee_email: "u2@example.com" } as never,
    ]);

    const res = await getReq("http://localhost/api/invites?projectId=p1");
    const body = await res.json();

    expect(listSentInvites).toHaveBeenCalledWith(expect.anything(), "p1");
    expect(listReceivedInvites).not.toHaveBeenCalled();
    expect(body.invites).toEqual([{ id: "inv2", project_name: "Proyecto B", invitee_email: "u2@example.com" }]);
  });
});
