/**
 * Best-effort in-memory sliding-window rate limiter for `POST /api/desktop-session`, keyed by
 * client IP. This endpoint is reachable WITHOUT any prior auth (unlike `/api/mcp`, which only
 * rate-limits after a valid token) — every hit, even with garbage tokens, costs a real network
 * round-trip to Supabase Auth (`getUser()` always verifies server-side, see
 * `src/lib/supabase/desktopSession.ts`). An unauthenticated flood could burn through Supabase's
 * shared project-wide Auth rate limit and degrade real login/`/auth/callback` traffic.
 *
 * IMPORTANT — this is NOT a hard guarantee, just a cheap first line of defense:
 * - State lives in a module-level `Map`, in memory, **per serverless instance**. Vercel can (and
 *   does) run multiple warm instances under load, each with its own independent counter — so the
 *   real effective ceiling under heavy concurrent traffic is `MAX_REQUESTS_PER_WINDOW × (number of
 *   warm instances)`, not a strict global cap.
 * - A real guarantee needs an infra-level control (Vercel Firewall/WAF rate limiting, or a shared
 *   store like Upstash/Redis). This module does not replace that — it just stops the cheapest,
 *   single-instance floods from hammering Supabase Auth for free.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

// key (IP) -> timestamps (ms) of requests seen within the current window.
const hits = new Map<string, number[]>();

/**
 * Pure sliding-window check: given the existing timestamps for a key and the current time, is a
 * new request allowed? Returns the pruned+updated timestamp list to store for that key. Kept
 * separate from the module-level `Map` so the window math is unit-testable without depending on
 * shared mutable state.
 */
export function checkSlidingWindow(
  timestamps: number[],
  now: number,
  windowMs: number = WINDOW_MS,
  maxRequests: number = MAX_REQUESTS_PER_WINDOW
): { allowed: boolean; timestamps: number[] } {
  const cutoff = now - windowMs;
  const recent = timestamps.filter((t) => t > cutoff);
  if (recent.length >= maxRequests) {
    return { allowed: false, timestamps: recent };
  }
  recent.push(now);
  return { allowed: true, timestamps: recent };
}

/**
 * True if `ip` has already used up its quota (20 req/min) and this request should be rejected.
 * Records this attempt as a side-effect when it's allowed, same as any request-counter check.
 */
export function isDesktopSessionRateLimited(ip: string, now: number = Date.now()): boolean {
  const existing = hits.get(ip) ?? [];
  const { allowed, timestamps } = checkSlidingWindow(existing, now);
  hits.set(ip, timestamps);
  return !allowed;
}

/**
 * Best-effort client IP from the standard `x-forwarded-for` header Vercel sets. Falls back to a
 * fixed key when absent (e.g. local dev without a proxy in front) so the limiter still applies
 * globally instead of silently no-op-ing for every request.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}

/** Test-only: clears all in-memory state between test runs. */
export function resetDesktopSessionRateLimitForTests() {
  hits.clear();
}
