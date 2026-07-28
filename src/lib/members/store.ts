import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isMissingTableError } from "@/lib/supabase/schema-compat";

export type ProjectMember = {
  project_id: string;
  user_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  granted_by: string | null;
  created_at: string;
};

const MEMBER_COLUMNS = "project_id, user_id, role, granted_by, created_at";

/** True for the `protect_project_owner` trigger's plain exceptions (migration
 * `20260728140000_project_members.sql`) — raised without a specific SQLSTATE, so matched by
 * message text like the rest of this repo's error-shape helpers. Defense in depth: the route
 * already pre-checks via `resolveRoleChangeError`/`resolveRemovalError` before ever reaching the
 * DB, but a race (role changed between the read and the write) still needs a human message
 * instead of a raw 500. */
function isOwnerProtectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return message.includes("project owner cannot be removed") || message.includes("project owner cannot be demoted");
}

/**
 * Team Sharing slice 1b, Phase 9.1. Lists a project's members via the CALLER's RLS-scoped
 * client — the `project_members: read` policy (migration `20260728150000_permission_kernel.sql`)
 * already requires `has_project_access(project_id, auth.uid(), 'read')`, so this is lecture-only:
 * no explicit capability re-check here (I-8, "lecturas: solo RLS, una sola fuente"). Degrades to
 * `[]` instead of a 500 while Phase 2/3's migrations are not applied to production yet.
 */
export async function listProjectMembers(supabase: SupabaseClient, projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, user_id, role, granted_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("[members] listProjectMembers failed", { projectId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, stage: "list-project-members" } });
    return [];
  }
  return (data ?? []) as ProjectMember[];
}

export type ProjectMemberWithEmail = ProjectMember & { email: string | null };

/**
 * Resolves each member's `email` via the SERVICE-ROLE client — `profiles` RLS only lets a session
 * see its OWN row (same reasoning as `resolveUserIdByEmail` in `@/lib/invites/store`), so the
 * "quién es" column of the members list would otherwise show nothing but raw `user_id`s for
 * everyone except the caller. The `project_members` row is the authorization here too: the caller
 * already legitimately sees these ids via `listProjectMembers` (RLS on `project_members`), this
 * only resolves id → email for display. Degrades to `email: null` per row on any DB error.
 */
export async function attachMemberEmails(
  serviceClient: SupabaseClient,
  members: ProjectMember[]
): Promise<ProjectMemberWithEmail[]> {
  if (members.length === 0) return [];

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const { data, error } = await serviceClient.from("profiles").select("id, email").in("id", userIds);

  if (error) {
    console.error("[members] attachMemberEmails failed", { error: error.message });
    Sentry.captureException(error, { extra: { stage: "attach-member-emails" } });
    return members.map((m) => ({ ...m, email: null }));
  }

  const emailById = new Map(((data ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email]));
  return members.map((m) => ({ ...m, email: emailById.get(m.user_id) ?? null }));
}

/** Single member row, used by the PATCH/DELETE route to read the CURRENT role before deciding
 * whether a role-change/removal is even allowed (`resolveRoleChangeError`/`resolveRemovalError`
 * need the target's current role, not just the new one). Same RLS-scoped, lecture-only rationale
 * as `listProjectMembers` — returns `null` on any error instead of throwing. */
export async function getProjectMember(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProjectMember | null> {
  const { data, error } = await supabase
    .from("project_members")
    .select(MEMBER_COLUMNS)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[members] getProjectMember failed", { projectId, userId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, userId, stage: "get-project-member" } });
    return null;
  }
  return (data as ProjectMember) ?? null;
}

export type UpdateMemberRoleResult =
  | { ok: true; member: ProjectMember }
  | { ok: false; error: string; code: "not_found" | "owner_protected" | "not_ready" | "server_error" };

/**
 * Changes a member's role via the CALLER's session-scoped client — the `share` capability was
 * already checked explicitly in the route (I-8, same defense-in-depth pattern as `createInvite`),
 * and `protect_project_owner` re-enforces the "owner is immutable" rule again here regardless.
 */
export async function updateProjectMemberRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  role: "admin" | "editor" | "viewer"
): Promise<UpdateMemberRoleResult> {
  const { data, error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select(MEMBER_COLUMNS)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: "Gestionar miembros todavía no está disponible.", code: "not_ready" };
    }
    if (isOwnerProtectionError(error)) {
      return { ok: false, error: "No se puede cambiar el rol del dueño del proyecto.", code: "owner_protected" };
    }
    console.error("[members] updateProjectMemberRole failed", { projectId, userId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, userId, stage: "update-member-role" } });
    return { ok: false, error: "No se pudo cambiar el rol.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "No encontramos a esa persona en este proyecto.", code: "not_found" };
  }
  return { ok: true, member: data as ProjectMember };
}

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; error: string; code: "not_found" | "owner_protected" | "not_ready" | "server_error" };

/** Removes a member row — deleting never touches the user's own transcriptions/projects, only
 * this project's membership grant. Same caller-scoped client + owner-protection rationale as
 * `updateProjectMemberRole`. */
export async function removeProjectMember(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<RemoveMemberResult> {
  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: "Gestionar miembros todavía no está disponible.", code: "not_ready" };
    }
    if (isOwnerProtectionError(error)) {
      return { ok: false, error: "No se puede quitar al dueño del proyecto.", code: "owner_protected" };
    }
    console.error("[members] removeProjectMember failed", { projectId, userId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, userId, stage: "remove-project-member" } });
    return { ok: false, error: "No se pudo quitar a esa persona.", code: "server_error" };
  }
  if (!data) {
    return { ok: false, error: "No encontramos a esa persona en este proyecto.", code: "not_found" };
  }
  return { ok: true };
}
