import { describe, it, expect, vi } from "vitest";
import { buildOwnOrAccessibleFilter, getAccessibleProjectIds } from "./permissions";

describe("buildOwnOrAccessibleFilter — pure, no I/O", () => {
  it("falls back to the own-row clause only when there are no accessible projects", () => {
    expect(buildOwnOrAccessibleFilter("user-A", [])).toBe("user_id.eq.user-A");
  });

  it("combines the own-row clause with an .in() over the accessible project ids", () => {
    expect(buildOwnOrAccessibleFilter("user-A", ["p1", "p2"])).toBe(
      "user_id.eq.user-A,project_id.in.(p1,p2)"
    );
  });

  it("uses a custom id column for tables where the accessible id IS the row id (projects)", () => {
    expect(buildOwnOrAccessibleFilter("user-A", ["p1", "p2"], "id")).toBe(
      "user_id.eq.user-A,id.in.(p1,p2)"
    );
  });

  it("never produces an empty .in.() clause — that is invalid PostgREST filter syntax", () => {
    const filter = buildOwnOrAccessibleFilter("user-A", []);
    expect(filter).not.toContain("in.()");
  });
});

describe("getAccessibleProjectIds — thin RPC wrapper (ADR-05: the ONLY function in lib/mcp/ that touches permissions)", () => {
  it("guards against a falsy userId — never touches Supabase", async () => {
    const rpc = vi.fn();
    const result = await getAccessibleProjectIds({ rpc } as never, "");
    expect(result).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the accessible_project_ids RPC with capability='read' by default", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await getAccessibleProjectIds({ rpc } as never, "user-A");
    expect(rpc).toHaveBeenCalledWith("accessible_project_ids", {
      p_user_id: "user-A",
      p_capability: "read",
    });
  });

  it("forwards an explicit capability", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await getAccessibleProjectIds({ rpc } as never, "user-A", "write");
    expect(rpc).toHaveBeenCalledWith("accessible_project_ids", {
      p_user_id: "user-A",
      p_capability: "write",
    });
  });

  it("unwraps PostgREST's array-of-objects shape for a scalar setof function", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ accessible_project_ids: "p1" }, { accessible_project_ids: "p2" }],
      error: null,
    });
    const result = await getAccessibleProjectIds({ rpc } as never, "user-A");
    expect(result).toEqual(["p1", "p2"]);
  });

  it("also accepts a flat array of plain uuid strings, defensively", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["p1", "p2"], error: null });
    const result = await getAccessibleProjectIds({ rpc } as never, "user-A");
    expect(result).toEqual(["p1", "p2"]);
  });

  it("fails CLOSED — an RPC error returns an empty list, never throws", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const result = await getAccessibleProjectIds({ rpc } as never, "user-A");
    expect(result).toEqual([]);
  });

  it("returns an empty list when data is null without an error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const result = await getAccessibleProjectIds({ rpc } as never, "user-A");
    expect(result).toEqual([]);
  });
});
