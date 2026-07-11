/**
 * Opaque bearer tokens for the read-only remote MCP server (`src/app/api/mcp/route.ts`).
 *
 * These are NOT Supabase JWTs — `getApiUser` (`src/lib/supabase/api.ts`) only understands real
 * Supabase session tokens, so an external MCP client (Claude Desktop, ChatGPT, etc.) is handed a
 * separate, opaque, high-entropy credential instead, modeled after a GitHub personal access
 * token: shown to the user exactly once at creation time (Phase 2), only its HMAC-SHA256 hash is
 * ever persisted (see `supabase/migrations/20260711150000_mcp_tokens.sql`, `mcp_tokens.token_hash`).
 *
 * `hashMcpToken` mirrors the `signState`/`verifyState` pattern already established in
 * `src/lib/crypto.ts` (HMAC-SHA256 keyed by a server-only secret), but deliberately does NOT
 * reuse `crypto.ts`'s `decodeKey` (which requires the key to base64-decode to exactly 32 raw
 * bytes) — that constraint is specific to AES-256's fixed key size, not to HMAC-SHA256, which
 * accepts a key of any length. Requiring base64+32 bytes here would just be unnecessary friction
 * for a secret that only ever needs to be a long, random, opaque string (e.g.
 * `openssl rand -hex 32`, used directly).
 */
import { randomBytes, createHmac } from "node:crypto";

/** Recognizable prefix (same idea as `ghp_`/`sk-`) so a leaked token is identifiable at a glance. */
export const MCP_TOKEN_PREFIX = "mcpt_";

/**
 * HMAC-SHA256 hex digest of `token`, keyed with `MCP_TOKEN_HASH_SECRET`. Deterministic (same
 * token + same secret always produces the same hash) so a presented bearer token can be looked
 * up by its hash (`mcp_tokens.token_hash`, unique-indexed) without ever storing the raw token.
 *
 * Fails CLOSED: throws if the secret is missing or empty, rather than silently hashing with a
 * default/absent key — an MCP token's hash must never be reproducible without the real secret.
 */
export function hashMcpToken(token: string): string {
  const secret = process.env.MCP_TOKEN_HASH_SECRET;
  if (!secret) {
    throw new Error(
      "Missing MCP_TOKEN_HASH_SECRET — refusing to hash an MCP token without a server-side secret configured."
    );
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

/**
 * Generates a new opaque MCP token: `MCP_TOKEN_PREFIX` + 256 bits of randomness (base64url, no
 * padding). Returns both the raw `token` (shown to the user exactly once, never persisted) and
 * its `hash` (what the caller actually stores in `mcp_tokens.token_hash`).
 */
export function generateMcpToken(): { token: string; hash: string } {
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashMcpToken(token) };
}
