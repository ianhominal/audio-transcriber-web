import { describe, it, expect, vi, beforeEach } from "vitest";

// `createServerClient` does real I/O (network round-trip to Supabase Auth) — mocked so each test
// controls `setSession`/`getUser` directly, same "mock the I/O boundary" pattern as
// `vi.mock("@/lib/supabase/api")` in the route tests. The mock also lets tests simulate the SSR
// cookie adapter (`options.cookies.setAll`) being invoked by the real library during `setSession`.
const setSessionMock = vi.fn();
const getUserMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

import { establishDesktopSession } from "./desktopSession";

type CookieAdapter = {
  cookies: {
    getAll: () => unknown[];
    setAll: (
      cookies: { name: string; value: string; options: Record<string, unknown> }[],
      headers: Record<string, string>
    ) => void;
  };
};

function lastCookieAdapter(): CookieAdapter["cookies"] {
  const call = createServerClientMock.mock.calls.at(-1) as [string, string, CookieAdapter];
  return call[2].cookies;
}

beforeEach(() => {
  setSessionMock.mockReset();
  getUserMock.mockReset();
  createServerClientMock.mockReset();
  createServerClientMock.mockImplementation(() => ({
    auth: { setSession: setSessionMock, getUser: getUserMock },
  }));
});

describe("establishDesktopSession", () => {
  it("returns ok + the cookies emitted by the SSR cookie adapter when the token pair verifies", async () => {
    setSessionMock.mockImplementation(async () => {
      lastCookieAdapter().setAll(
        [{ name: "sb-test-auth-token", value: "chunked-session-value", options: { path: "/", httpOnly: true } }],
        { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" }
      );
      return { data: { session: {}, user: { id: "u1" } }, error: null };
    });
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    const result = await establishDesktopSession("valid-access-token", "valid-refresh-token");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.cookies).toEqual([
      { name: "sb-test-auth-token", value: "chunked-session-value", options: { path: "/", httpOnly: true } },
    ]);
    expect(result.headers).toEqual({ "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" });
  });

  it("calls setSession with exactly the given token pair", async () => {
    setSessionMock.mockResolvedValue({ data: {}, error: null });
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    await establishDesktopSession("access-123", "refresh-456");

    expect(setSessionMock).toHaveBeenCalledWith({
      access_token: "access-123",
      refresh_token: "refresh-456",
    });
  });

  it("returns not-ok when setSession itself errors (garbage/malformed token)", async () => {
    setSessionMock.mockResolvedValue({ data: {}, error: { message: "invalid JWT" } });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const result = await establishDesktopSession("garbage", "garbage");

    expect(result).toEqual({ ok: false });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns not-ok when getUser fails to verify, even though setSession looked fine", async () => {
    setSessionMock.mockResolvedValue({ data: { session: {} }, error: null });
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid claim: token is expired" } });

    const result = await establishDesktopSession("expired-access", "expired-refresh");

    expect(result).toEqual({ ok: false });
  });

  it("never leaks cookies buffered before a failed getUser verification", async () => {
    setSessionMock.mockImplementation(async () => {
      lastCookieAdapter().setAll([{ name: "sb-test-auth-token", value: "should-not-leak", options: {} }], {});
      return { data: { session: {} }, error: null };
    });
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });

    const result = await establishDesktopSession("token", "token");

    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("should-not-leak");
  });

  it("the cookie adapter's getAll() has nothing to read (this establishes a brand new session, not a refresh)", async () => {
    setSessionMock.mockResolvedValue({ data: {}, error: null });
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    await establishDesktopSession("access", "refresh");

    expect(lastCookieAdapter().getAll()).toEqual([]);
  });
});
