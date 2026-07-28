/** Roles that can be invited to a project. `owner` is excluded on purpose — it is materialized
 * automatically for whoever creates the project (`materialize_project_owner` trigger) and can
 * never be assigned or transferred in Fase 1 (design.md ADR-01). */
const INVITABLE_ROLES = ["admin", "editor", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** PURE. True if `role` is one of the roles this endpoint is allowed to invite as. Deliberately a
 * plain allowlist check, NOT a permissions decision (I-2: role→capability lives ONLY in
 * `role_has_capability` SQL) — this only validates the shape of the request body. */
export function isValidInviteRole(role: unknown): role is InvitableRole {
  return typeof role === "string" && (INVITABLE_ROLES as readonly string[]).includes(role);
}

// Same pragmatic format check the rest of the repo uses for user input (not a full RFC 5322
// validator — Supabase Auth already validated the email when the account was created; this only
// guards against obviously malformed input before it reaches the service-role lookup).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 §4.5.3.1.3

/**
 * PURE. Normalizes and validates an email for an invite: trims, lowercases (emails are
 * case-insensitive for matching purposes and `profiles.email` is stored as Supabase Auth sends
 * it, which is already lowercased for most providers but not guaranteed for all — normalizing
 * here avoids a false "no account" for a same address with different casing), and rejects
 * anything that isn't a plausible email shape. Returns `null` on any invalid input instead of
 * throwing, matching the pattern of `sanitizeTerm`/`sanitizeMcpTokenLabel` elsewhere in the repo.
 */
export function sanitizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}
