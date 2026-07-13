import { createServerClient, type CookieOptions } from "@supabase/ssr";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export type CookieToSet = { name: string; value: string; options: CookieOptions };

export type DesktopSessionResult =
  | { ok: true; cookies: CookieToSet[]; headers: Record<string, string> }
  | { ok: false };

/**
 * Turns a desktop client's Supabase token pair (already obtained via the same login the desktop
 * uses for its `Authorization: Bearer` sync calls) into real Supabase session cookies, so the
 * caller can copy them into an embedded WebView2 cookie jar and land on an already-logged-in page.
 *
 * Cookies are buffered in memory via the `@supabase/ssr` cookie adapter (never written straight
 * to a real response) so that a failed verification can discard them entirely — no cookie ever
 * escapes this function unless `getUser()` round-tripped the token against Supabase Auth and came
 * back with a real user. `setSession()` alone only decodes the JWT locally and must never be
 * trusted for that decision (see `types.d.ts` in `@supabase/ssr`: `getSession()`'s user is "not
 * verified"; `getUser()` "contacts the Auth server on every call to validate the token").
 */
export async function establishDesktopSession(
  accessToken: string,
  refreshToken: string
): Promise<DesktopSessionResult> {
  const cookies: CookieToSet[] = [];
  let headers: Record<string, string> = {};

  const supabase = createServerClient(URL, KEY, {
    cookies: {
      getAll() {
        // No existing session to read — this call establishes a brand new one from the tokens
        // the desktop already holds.
        return [];
      },
      setAll(cookiesToSet, responseHeaders) {
        cookies.push(...cookiesToSet);
        headers = { ...headers, ...responseHeaders };
      },
    },
  });

  const { error: setSessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setSessionError) {
    return { ok: false };
  }

  // Security-critical: force a real round-trip against the Supabase Auth server. `getUser()`
  // verifies the JWT signature server-side; a locally-decoded session must never be trusted alone
  // for this decision.
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();
  if (getUserError || !user) {
    return { ok: false };
  }

  return { ok: true, cookies, headers };
}
