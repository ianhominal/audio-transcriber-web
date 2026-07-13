/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — full-text search across ALL of a user's notes.
 * PURE module (no Supabase, no network): sanitizes the raw search query typed by the user BEFORE it
 * reaches `websearch_to_tsquery` (via Supabase's `.textSearch(..., { type: "websearch" })`, see
 * `src/app/api/notes/search/route.ts`).
 *
 * A note on "sanitization" here: `websearch_to_tsquery` is designed by Postgres specifically to
 * accept raw, unsanitized web-search-style input — it "will never raise syntax errors" (see the
 * `@supabase/postgrest-js` `.textSearch()` doc comment), and it's sent to PostgREST as a BOUND filter
 * VALUE (via `URLSearchParams`, not string concatenation into SQL), so there is no SQL-injection
 * surface regardless of what characters the query contains. What THIS module guards against is
 * cost/abuse (an absurdly long query string) and garbage input (non-string, empty) — same criteria
 * as every other input cap in this app (`isValidChatMessageText`, `sanitizeMergeInstruction`, etc.).
 */

/**
 * Cap on the search query length. Generous for a real search phrase (a person doesn't type a
 * 200-character search), but a hard defense against a client sending something pathological as the
 * `q` param — same "hard cost/abuse defense, not a context-window concern" criteria as
 * `MAX_CHAT_MESSAGE_CHARS`.
 */
export const MAX_SEARCH_QUERY_CHARS = 200;

/**
 * Trims and caps the raw search query. Returns `""` for anything that isn't a non-empty string after
 * trimming — the caller (`isValidSearchQuery`) decides whether `""` means "no query yet" (search bar
 * fallback: show nothing) vs. an error, never throws.
 */
export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_SEARCH_QUERY_CHARS ? trimmed.slice(0, MAX_SEARCH_QUERY_CHARS) : trimmed;
}

/** true if `query` (already sanitized or not) is a non-empty search query worth running. */
export function isValidSearchQuery(query: string): boolean {
  return query.trim().length > 0;
}

/**
 * Builds the PostgREST `.or()` filter string for the ILIKE fallback search (used only when
 * `search_vector` hasn't been migrated yet in the target environment — see `isMissingColumnError` in
 * `src/app/api/notes/search/route.ts` — a narrow, temporary rollout window, not the normal path).
 *
 * Escapes `query` per PostgREST's value-escaping rules (wrap the whole value in double quotes,
 * backslash-escape `\` and `"` inside it) so a query containing `,`/`(`/`)` — characters that are
 * otherwise SIGNIFICANT to PostgREST's own filter syntax inside `.or()` — can never break out of the
 * intended ilike conditions and inject an extra clause into the request (e.g. smuggling a
 * `,user_id.neq.<id>` past the columns this function was told to search). Pure: builds a string only,
 * never touches the network — the caller passes it straight to `.or(...)`.
 *
 * ALSO escapes `%`/`_` — Postgres `ILIKE` wildcard metacharacters — so a literal `%`/`_` typed by the
 * user (e.g. searching for "50% done") matches itself instead of being silently reinterpreted as a
 * wildcard (correctness fix from the adversarial review: this was a wrong-results bug, not a security
 * one — scope stays within the user's own rows either way). Order matters: backslash is escaped
 * FIRST, before any of the other escapes introduce new backslashes that would otherwise get
 * double-escaped.
 */
export function buildIlikeOrFilter(query: string, columns: readonly string[]): string {
  const escaped = query
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
  const pattern = `"%${escaped}%"`;
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}
