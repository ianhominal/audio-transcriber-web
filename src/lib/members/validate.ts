/** Team Sharing UI batch — role hierarchy for `project_members`. `owner` is materialized
 * automatically (`materialize_project_owner` trigger) and can never be assigned by a client; it
 * only appears here as a rank so `resolveRoleChangeError` can compare against it. */
export type MemberRole = "owner" | "admin" | "editor" | "viewer";

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/**
 * PURE. Decides whether a role-change request should be rejected BEFORE hitting the database, so
 * the caller gets a clear, human error instead of the `protect_project_owner` trigger's raw
 * exception surfacing as a 500. Two independent rules (design/spec "gestionar roles"):
 *  1. The owner's role can never change (DB trigger: "the project owner cannot be demoted").
 *  2. Nobody can promote THEMSELVES to a higher rank — self-service escalation, even by an admin
 *     with `share`, is not allowed (a demotion of yourself is fine, that is just giving up power).
 * Returns a ready-to-show Spanish message, or `null` when the change is allowed. This is a plain
 * business rule about role ASSIGNMENT, not a capability decision — role→capability itself still
 * lives ONLY in `role_has_capability` SQL (I-2), never reimplemented here.
 */
export function resolveRoleChangeError(params: {
  currentRole: MemberRole;
  isSelf: boolean;
  newRole: MemberRole;
}): string | null {
  if (params.currentRole === "owner") {
    return "No se puede cambiar el rol del dueño del proyecto.";
  }
  if (params.isSelf && ROLE_RANK[params.newRole] > ROLE_RANK[params.currentRole]) {
    return "No podés subirte el rol a vos mismo.";
  }
  return null;
}

/**
 * PURE. Same idea as `resolveRoleChangeError` but for removal: the owner can never be removed
 * (DB trigger: "the project owner cannot be removed"). Anyone else — including removing yourself
 * to leave the project — is allowed; `share` capability is what the route already checked.
 */
export function resolveRemovalError(currentRole: MemberRole): string | null {
  if (currentRole === "owner") {
    return "No se puede quitar al dueño del proyecto.";
  }
  return null;
}
