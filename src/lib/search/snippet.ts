/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — snippet/highlight extraction for search
 * results. PURE module: builds a short excerpt around the first match of the query in a note's
 * text, split into segments so the UI can render the matched part highlighted (`<mark>`), without
 * needing Postgres `ts_headline` (a valid alternative per the brief, but this keeps the search route
 * a single query with no extra RPC/SQL function to maintain for the MVP).
 *
 * Matching here is a SIMPLE case/accent-insensitive substring check on the raw query terms — not a
 * reimplementation of Spanish stemming (`websearch_to_tsquery('spanish', ...)` already did the real
 * matching in the DB to select these rows; this module only decides WHERE to cut the snippet and
 * WHAT to visually highlight). When a stemmed match doesn't have a literal substring hit (e.g. the
 * row matched via "reuniones" → "reunión" but the query term is "reunir"), this falls back to a
 * plain leading excerpt with no highlight — a reasonable MVP trade-off, not a correctness bug.
 */

export type SearchSnippetSegment = { text: string; match: boolean };

/** Characters of context kept on each side of the match. */
const SNIPPET_CONTEXT_CHARS = 70;
/** Cap on the fallback (no-match) excerpt length. */
const SNIPPET_MAX_CHARS = 220;

/** Case/accent-insensitive normalization ("Reunión" / "reunion" / "REUNIÓN" all compare equal).
 * Decomposes accented letters (NFD) into base letter + combining mark, then strips every character
 * in Unicode category "Mark" (`\p{M}`, covers all combining diacritics, not just Spanish ones). */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Extracts the plain terms worth highlighting from a `websearch_to_tsquery`-style query: splits on
 * whitespace, drops the `-exclusion` operator entirely (a token prefixed with `-` means "must NOT
 * appear" — highlighting it would be actively misleading), strips quote marks (phrase grouping), and
 * drops the literal word "or" (the websearch OR operator) and single-character tokens (too noisy to
 * highlight). Case/accent-insensitive, deduplicated.
 */
export function extractSearchTerms(query: string): string[] {
  const rawTokens = query.trim().split(/\s+/).filter(Boolean);
  const terms = new Set<string>();

  for (const rawToken of rawTokens) {
    if (rawToken.startsWith("-")) continue;
    const cleaned = normalize(rawToken.replace(/['"]/g, ""));
    if (cleaned.length >= 2 && cleaned !== "or") terms.add(cleaned);
  }

  return [...terms];
}

/**
 * Builds a snippet of `source` (a note's title, text, or summary) around the first occurrence of any
 * term in `query`, as an ordered list of segments (`match: true` for the part to highlight). Returns
 * `[]` for an empty/blank `source`. Never throws.
 */
export function buildSearchSnippet(source: string, query: string): SearchSnippetSegment[] {
  const trimmedSource = source.trim();
  if (!trimmedSource) return [];

  const terms = extractSearchTerms(query);
  const normalizedSource = normalize(trimmedSource);

  let matchStart = -1;
  let matchLen = 0;
  for (const term of terms) {
    const idx = normalizedSource.indexOf(term);
    if (idx !== -1 && (matchStart === -1 || idx < matchStart)) {
      matchStart = idx;
      matchLen = term.length;
    }
  }

  if (matchStart === -1) {
    const plain = trimmedSource.slice(0, SNIPPET_MAX_CHARS);
    const truncated = trimmedSource.length > SNIPPET_MAX_CHARS;
    return [{ text: truncated ? `${plain}…` : plain, match: false }];
  }

  const windowStart = Math.max(0, matchStart - SNIPPET_CONTEXT_CHARS);
  const windowEnd = Math.min(trimmedSource.length, matchStart + matchLen + SNIPPET_CONTEXT_CHARS);

  const segments: SearchSnippetSegment[] = [];
  const beforeText = trimmedSource.slice(windowStart, matchStart);
  const before = (windowStart > 0 ? "…" : "") + beforeText;
  if (before) segments.push({ text: before, match: false });

  segments.push({ text: trimmedSource.slice(matchStart, matchStart + matchLen), match: true });

  const afterText = trimmedSource.slice(matchStart + matchLen, windowEnd);
  const after = afterText + (windowEnd < trimmedSource.length ? "…" : "");
  if (after) segments.push({ text: after, match: false });

  return segments;
}

/**
 * Picks the best snippet across several candidate sources for the SAME note (in priority order —
 * typically `[text, parsed summary, title]`), preferring the first candidate that actually contains a
 * literal highlightable match. Falls back to a plain (unhighlighted) excerpt of the first non-empty
 * candidate if none of them match literally (e.g. the row only matched via Spanish stemming). Skips
 * `null`/`undefined`/blank candidates. Returns `[]` if every candidate is empty.
 */
export function pickBestSnippet(
  sources: readonly (string | null | undefined)[],
  query: string
): SearchSnippetSegment[] {
  const candidates = sources.filter((s): s is string => !!s && s.trim().length > 0);

  for (const candidate of candidates) {
    const segments = buildSearchSnippet(candidate, query);
    if (segments.some((s) => s.match)) return segments;
  }

  return candidates.length > 0 ? buildSearchSnippet(candidates[0], query) : [];
}
