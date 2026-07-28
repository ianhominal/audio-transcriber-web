import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isMissingTableError } from "@/lib/supabase/schema-compat";
import type { InvitableRole } from "./validate";

/**
 * Team Sharing slice 1b, Phase 9 (spec "Invitaciones modelo GitHub — solo a usuarios existentes,
 * requieren aceptación"). No email/token/link ever leaves the server: the invite row itself only
 * ever stores an EXISTING `user_id` (`resolveUserIdByEmail`), and the acceptance/rejection state
 * machine lives entirely in SQL (`project_invites` RLS + `accept_project_invite`, migrations
 * `20260728180000_project_invites.sql` / `20260728210000_project_invites_accept_cancel.sql`) —
 * this module is a thin, testable wrapper around that SQL, never a second source of truth for who
 * can do what.
 */

export type ProjectInvite = {
  id: string;
  project_id: string;
  invited_user_id: string;
  role: InvitableRole;
  invited_by: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  resolved_at: string | null;
};

/** True for Postgres "function does not exist" (`42883`) — the `accept_project_invite` RPC comes
 * from a migration that, like the rest of Phase 1-8, has not been applied to production yet at
 * the time this batch ships. Same expand/contract discipline as `isMissingTableError`/
 * `isMissingColumnError` in `schema-compat.ts`, kept local here since it is the only caller. */
function isMissingFunctionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code === "42883") return true;
  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    if (msg.includes("function") && msg.includes("does not exist")) return true;
  }
  return false;
}

export type ResolveEmailResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; code: "not_found" | "server_error" };

/**
 * Resolves an email to an EXISTING account's user id. MUST run against the SERVICE-ROLE client:
 * `profiles` RLS ("own profile") only lets a user read their OWN row, so a session-scoped lookup
 * by someone else's email always returns nothing — that is the intended privacy boundary, not a
 * bug to route around with a broader RLS policy (spec "modelo GitHub": the app never exposes
 * whether an arbitrary email has an account, except to the person explicitly trying to invite it,
 * and even then only as "yes, invited" / "no account", never the account's other data).
 */
export async function resolveUserIdByEmail(
  serviceClient: SupabaseClient,
  email: string
): Promise<ResolveEmailResult> {
  const { data, error } = await serviceClient.from("profiles").select("id").eq("email", email).maybeSingle();

  if (error) {
    console.error("[invites] resolveUserIdByEmail failed", { error: error.message });
    Sentry.captureException(error, { extra: { stage: "resolve-invite-email" } });
    return { ok: false, error: "No se pudo verificar el email.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "Esa persona todavía no tiene una cuenta en el producto.", code: "not_found" };
  }
  return { ok: true, userId: (data as { id: string }).id };
}

export type CreateInviteResult =
  | { ok: true; invite: ProjectInvite }
  | { ok: false; error: string; code: "duplicate" | "not_ready" | "server_error" };

/**
 * Inserts a `pending` invite via the CALLER's session-scoped client (never service-role): the
 * `project_invites: insert` RLS policy already requires `share` AND `invited_by = auth.uid()`
 * (I-8, defense in depth — the route handler ALSO checks the `share` capability explicitly via
 * the `has_project_access` RPC before ever calling this function; RLS enforces it again here
 * regardless, so a bug in the route's own check can't open a hole).
 */
export async function createInvite(
  supabase: SupabaseClient,
  params: { projectId: string; invitedUserId: string; role: InvitableRole; invitedBy: string }
): Promise<CreateInviteResult> {
  const { data, error } = await supabase
    .from("project_invites")
    .insert({
      project_id: params.projectId,
      invited_user_id: params.invitedUserId,
      role: params.role,
      invited_by: params.invitedBy,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: "Las invitaciones todavía no están disponibles.", code: "not_ready" };
    }
    // `project_invites_pending_idx` — a `pending` invite for the same project+user already exists.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "Ya hay una invitación pendiente para esa persona.", code: "duplicate" };
    }
    console.error("[invites] createInvite failed", { error: error.message, ...params });
    Sentry.captureException(error, { extra: { stage: "create-invite", ...params } });
    return { ok: false, error: "No se pudo crear la invitación.", code: "server_error" };
  }

  return { ok: true, invite: data as ProjectInvite };
}

/** Invitations SENT for a project (owner/admin view) — RLS (`share` capability) is the only
 * scoping; this never adds a redundant filter that could mask what RLS actually allows (I-8:
 * lecturas, solo RLS). Degrades to `[]`, never a 500, while the migration is not applied yet. */
export async function listSentInvites(supabase: SupabaseClient, projectId: string): Promise<ProjectInvite[]> {
  const { data, error } = await supabase
    .from("project_invites")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("[invites] listSentInvites failed", { projectId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, stage: "list-sent-invites" } });
    return [];
  }
  return (data ?? []) as ProjectInvite[];
}

/** Invitations RECEIVED by the current user (the other half of Phase 9.5's "two views of the same
 * endpoint"). Same degrade rationale as `listSentInvites`. */
export async function listReceivedInvites(supabase: SupabaseClient, userId: string): Promise<ProjectInvite[]> {
  const { data, error } = await supabase
    .from("project_invites")
    .select("*")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("[invites] listReceivedInvites failed", { userId, error: error.message });
    Sentry.captureException(error, { extra: { userId, stage: "list-received-invites" } });
    return [];
  }
  return (data ?? []) as ProjectInvite[];
}

export type RespondInviteResult =
  | { ok: true }
  | { ok: false; error: string; code: "not_found" | "server_error" };

/**
 * Accepts a pending invite via the `accept_project_invite` RPC — see migration
 * `20260728210000_project_invites_accept_cancel.sql` for why this MUST be a single SECURITY
 * DEFINER transaction rather than two separate client calls (insert into `project_members` +
 * update `project_invites`). The RPC re-checks `invited_user_id = auth.uid()` and
 * `status = 'pending'` itself; this wrapper does not repeat that check.
 */
export async function acceptInvite(supabase: SupabaseClient, inviteId: string): Promise<RespondInviteResult> {
  const { error } = await supabase.rpc("accept_project_invite", { p_invite_id: inviteId });

  if (error) {
    if (isMissingFunctionError(error)) {
      return { ok: false, error: "Las invitaciones todavía no están disponibles.", code: "server_error" };
    }
    // The function raises a plain exception for "not found / not mine / not pending" — surfaced
    // uniformly as "not found", same "no hint which case" discipline as `revokeMcpToken` (mcp-
    // tokens/store.ts): telling an attacker WHY would leak whether the id exists at all.
    return { ok: false, error: "Invitación no encontrada o ya resuelta.", code: "not_found" };
  }
  return { ok: true };
}

/**
 * Rejects a pending invite: a direct UPDATE via the RLS-scoped client, allowed by the
 * `project_invites: update` policy (`invited_user_id = auth.uid()`). No transaction needed —
 * rejecting never touches `project_members`.
 */
export async function rejectInvite(
  supabase: SupabaseClient,
  inviteId: string,
  userId: string
): Promise<RespondInviteResult> {
  const { data, error } = await supabase
    .from("project_invites")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[invites] rejectInvite failed", { inviteId, error: error.message });
    Sentry.captureException(error, { extra: { inviteId, stage: "reject-invite" } });
    return { ok: false, error: "No se pudo rechazar la invitación.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "Invitación no encontrada o ya resuelta.", code: "not_found" };
  }
  return { ok: true };
}

/**
 * Cancels a pending invite by DELETING the row — `project_invites.status` has no fourth
 * "cancelled" value (spec only defines `pending → accepted | rejected`), and deleting also frees
 * `project_invites_pending_idx` immediately for a reinvite, with no extra state to reconcile.
 * Allowed by the `project_invites: delete` policy (inviter, or anyone with `share`) — the invited
 * user does NOT need to do anything (spec "cancelar no requiere acción del invitado").
 */
export async function cancelInvite(supabase: SupabaseClient, inviteId: string): Promise<RespondInviteResult> {
  const { data, error } = await supabase
    .from("project_invites")
    .delete()
    .eq("id", inviteId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[invites] cancelInvite failed", { inviteId, error: error.message });
    Sentry.captureException(error, { extra: { inviteId, stage: "cancel-invite" } });
    return { ok: false, error: "No se pudo cancelar la invitación.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "Invitación no encontrada o ya resuelta.", code: "not_found" };
  }
  return { ok: true };
}
