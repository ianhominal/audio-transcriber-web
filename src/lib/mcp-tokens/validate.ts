/**
 * Validation/sanitization for an MCP token label (Phase 2, see .claude/resources/BUSINESS.md and
 * `.claude/resources/changelog/2026-07-11.md`). PURE function with no server-only dependencies,
 * same reuse rationale as `src/lib/vocabulary/validate.ts`.
 */

/** Max length of a label. Unlike `MAX_TERM_LENGTH` (vocabulary), there is NO equivalent CHECK
 * constraint in migration `20260711150000_mcp_tokens.sql` — this is the only defense layer. */
export const MAX_MCP_TOKEN_LABEL_LENGTH = 100;

/** Matches the `label` column's default in the migration (`default 'MCP client'`). */
export const DEFAULT_MCP_TOKEN_LABEL = "MCP client";

/**
 * Normalizes a raw label (from a request body): trims it, truncates to
 * `MAX_MCP_TOKEN_LABEL_LENGTH`, and falls back to `DEFAULT_MCP_TOKEN_LABEL` if the input isn't a
 * string or ends up empty after trimming.
 *
 * Unlike `sanitizeTerm` (vocabulary, which returns `null` and forces a 400 on an overlong term),
 * this function NEVER rejects: a label is cosmetic metadata (a nickname for the token, e.g.
 * "Claude Desktop"), not meaningful user data — so an overlong label is silently truncated instead
 * of returning an error over something this trivial.
 */
export function sanitizeMcpTokenLabel(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_MCP_TOKEN_LABEL;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_MCP_TOKEN_LABEL;
  return trimmed.slice(0, MAX_MCP_TOKEN_LABEL_LENGTH);
}
