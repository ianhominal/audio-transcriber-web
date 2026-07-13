import { describe, it, expect, beforeEach, vi } from "vitest";

// `establishDesktopSession` does real I/O (Supabase Auth round-trip) — mocked so each test
// controls the outcome directly, same "mock the boundary" pattern as `vi.mock("@/lib/supabase/api")`
// in the other route tests (e.g. `api/mcp-tokens/route.test.ts`).
vi.mock("@/lib/supabase/desktopSession", () => ({
  establishDesktopSession: vi.fn(),
}));

import { establishDesktopSession } from "@/lib/supabase/desktopSession";
import { resetDesktopSessionRateLimitForTests } from "@/lib/desktopSessionRateLimit";
import { POST } from "./route";

function postSession(body: unknown, headers?: Record<string, string>) {
  const req =
    typeof body === "string"
      ? new Request("http://localhost/api/desktop-session", { method: "POST", body, headers })
      : new Request("http://localhost/api/desktop-session", {
          method: "POST",
          body: JSON.stringify(body),
          headers,
        });
  return POST(req as never);
}

beforeEach(() => {
  vi.mocked(establishDesktopSession).mockReset();
  // The rate limiter is real (not mocked) module-level state, keyed by IP — reset it between
  // tests so one test's requests never count against another's quota (all tests here share the
  // same "unknown" IP bucket, since none of them send `x-forwarded-for` unless testing that).
  resetDesktopSessionRateLimitForTests();
});

describe("POST /api/desktop-session — validation", () => {
  it("400 on a non-JSON body, without calling establishDesktopSession", async () => {
    const res = await postSession("not-json");
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("400 when access_token is missing", async () => {
    const res = await postSession({ refresh_token: "r1" });
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("400 when refresh_token is missing", async () => {
    const res = await postSession({ access_token: "a1" });
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("400 when a token field is present but empty", async () => {
    const res = await postSession({ access_token: "", refresh_token: "r1" });
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("400 error body never echoes back a token VALUE sent by the client", async () => {
    const res = await postSession({ access_token: "", refresh_token: "super-secret-refresh-value" });
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("super-secret-refresh-value");
  });

  it("400 when access_token exceeds the 4096-char max (unauthenticated endpoint — no oversized payloads reach the Supabase SDK)", async () => {
    const res = await postSession({ access_token: "a".repeat(4097), refresh_token: "r" });
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("400 when refresh_token exceeds the 4096-char max", async () => {
    const res = await postSession({ access_token: "a", refresh_token: "r".repeat(4097) });
    expect(res.status).toBe(400);
    expect(establishDesktopSession).not.toHaveBeenCalled();
  });

  it("accepts a token right at the 4096-char boundary", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({ ok: false });
    await postSession({ access_token: "a".repeat(4096), refresh_token: "r".repeat(4096) });
    expect(establishDesktopSession).toHaveBeenCalled();
  });
});

describe("POST /api/desktop-session — valid token pair", () => {
  it("200 with the session cookies attached via Set-Cookie, sourced from establishDesktopSession", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({
      ok: true,
      cookies: [{ name: "sb-test-auth-token", value: "cookie-value", options: { path: "/", httpOnly: true } }],
      headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
    });

    const res = await postSession({ access_token: "valid-a", refresh_token: "valid-r" });

    expect(res.status).toBe(200);
    expect(establishDesktopSession).toHaveBeenCalledWith("valid-a", "valid-r");

    const cookie = res.cookies.get("sb-test-auth-token");
    expect(cookie?.value).toBe("cookie-value");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");

    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it("attaches every cookie returned, not just the first", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({
      ok: true,
      cookies: [
        { name: "sb-test-auth-token.0", value: "part0", options: {} },
        { name: "sb-test-auth-token.1", value: "part1", options: {} },
      ],
      headers: {},
    });

    const res = await postSession({ access_token: "a", refresh_token: "r" });

    expect(res.cookies.get("sb-test-auth-token.0")?.value).toBe("part0");
    expect(res.cookies.get("sb-test-auth-token.1")?.value).toBe("part1");
  });
});

describe("POST /api/desktop-session — invalid/expired token pair", () => {
  it("401, no cookies set, and the body never contains the tokens sent", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({ ok: false });

    const res = await postSession({ access_token: "garbage", refresh_token: "garbage" });

    expect(res.status).toBe(401);
    expect(res.cookies.getAll()).toEqual([]);
    expect(res.headers.get("set-cookie")).toBeNull();

    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("garbage");
  });
});

describe("POST /api/desktop-session — unexpected errors", () => {
  it("500 with a clean JSON body when establishDesktopSession throws (e.g. a network error), never leaking the raw error", async () => {
    vi.mocked(establishDesktopSession).mockRejectedValue(new Error("ECONNRESET talking to Supabase Auth"));

    const res = await postSession({ access_token: "a", refresh_token: "r" });

    expect(res.status).toBe(500);
    expect(res.cookies.getAll()).toEqual([]);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("ECONNRESET");
  });
});

describe("POST /api/desktop-session — per-IP rate limiting", () => {
  it("429 after exceeding the per-IP quota (20/min) within the same window", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({ ok: false });

    for (let i = 0; i < 20; i++) {
      const res = await postSession({ access_token: "a", refresh_token: "r" });
      expect(res.status).not.toBe(429);
    }
    const blocked = await postSession({ access_token: "a", refresh_token: "r" });
    expect(blocked.status).toBe(429);
    expect(establishDesktopSession).toHaveBeenCalledTimes(20);
  });

  it("a distinct IP (via x-forwarded-for) gets its own independent quota", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({ ok: false });

    for (let i = 0; i < 20; i++) {
      await postSession({ access_token: "a", refresh_token: "r" }); // exhausts the default/"unknown" bucket
    }
    const blockedDefault = await postSession({ access_token: "a", refresh_token: "r" });
    expect(blockedDefault.status).toBe(429);

    const otherIp = await postSession(
      { access_token: "a", refresh_token: "r" },
      { "x-forwarded-for": "8.8.8.8" }
    );
    expect(otherIp.status).not.toBe(429);
  });

  it("rate limiting is checked BEFORE body parsing (a 21st request is 429 even with a garbage body)", async () => {
    vi.mocked(establishDesktopSession).mockResolvedValue({ ok: false });

    for (let i = 0; i < 20; i++) {
      await postSession({ access_token: "a", refresh_token: "r" });
    }
    const res = await postSession("not-json");
    expect(res.status).toBe(429);
  });
});
