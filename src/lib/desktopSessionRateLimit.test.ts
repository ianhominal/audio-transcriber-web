import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSlidingWindow,
  isDesktopSessionRateLimited,
  clientIpFromHeaders,
  resetDesktopSessionRateLimitForTests,
} from "./desktopSessionRateLimit";

describe("checkSlidingWindow", () => {
  it("allows a request when there's no prior history", () => {
    const { allowed, timestamps } = checkSlidingWindow([], 1000, 60_000, 20);
    expect(allowed).toBe(true);
    expect(timestamps).toEqual([1000]);
  });

  it("blocks once the window already has maxRequests entries", () => {
    const existing = Array.from({ length: 20 }, (_, i) => 1000 + i);
    const { allowed, timestamps } = checkSlidingWindow(existing, 1500, 60_000, 20);
    expect(allowed).toBe(false);
    // Blocked attempts are not recorded — timestamps returned unchanged.
    expect(timestamps).toEqual(existing);
  });

  it("allows exactly at the boundary (19 existing + 1 new = 20)", () => {
    const existing = Array.from({ length: 19 }, (_, i) => 1000 + i);
    const { allowed, timestamps } = checkSlidingWindow(existing, 1020, 60_000, 20);
    expect(allowed).toBe(true);
    expect(timestamps).toHaveLength(20);
  });

  it("drops timestamps older than the window before counting", () => {
    const existing = [0, 100, 200]; // all well outside a 60s window once "now" is far enough ahead
    const { allowed, timestamps } = checkSlidingWindow(existing, 100_000, 60_000, 20);
    expect(allowed).toBe(true);
    expect(timestamps).toEqual([100_000]);
  });
});

describe("isDesktopSessionRateLimited", () => {
  beforeEach(() => {
    resetDesktopSessionRateLimitForTests();
  });

  it("allows the first 20 requests from the same IP within a minute, blocks the 21st", () => {
    const ip = "1.2.3.4";
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      expect(isDesktopSessionRateLimited(ip, now + i)).toBe(false);
    }
    expect(isDesktopSessionRateLimited(ip, now + 20)).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      isDesktopSessionRateLimited("1.1.1.1", now + i);
    }
    expect(isDesktopSessionRateLimited("1.1.1.1", now + 20)).toBe(true);
    expect(isDesktopSessionRateLimited("2.2.2.2", now + 20)).toBe(false);
  });

  it("allows requests again once the window has slid past", () => {
    const ip = "9.9.9.9";
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      isDesktopSessionRateLimited(ip, now + i);
    }
    expect(isDesktopSessionRateLimited(ip, now + 20)).toBe(true);
    expect(isDesktopSessionRateLimited(ip, now + 60_001)).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("reads the first IP from x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.5");
  });

  it("falls back to a fixed key when the header is absent", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
