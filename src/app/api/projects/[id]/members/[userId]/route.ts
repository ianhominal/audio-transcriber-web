import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiUser } from "@/lib/supabase/api";
import { getProjectMember, updateProjectMemberRole, removeProjectMember } from "@/lib/members/store";
import { resolveRoleChangeError, resolveRemovalError } from "@/lib/members/validate";
import { isValidInviteRole } from "@/lib/invites/validate";

export const runtime = "nodejs";

/** Team Sharing UI batch. `PATCH` changes a member's role; `DELETE` removes them. Both require
 * capability `share` (verified the same way as `POST /api/projects/[id]/members`: calling
 * `has_project_access`, I-2 — never reimplemented in TS), plus a pre-check via
 * `resolveRoleChangeError`/`resolveRemovalError` (`@/lib/members/validate`) so an owner-protection
 * or self-promotion attempt comes back as a clear, human error instead of a raw 500 from the
 * `protect_project_owner` trigger. */

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same rationale as the sibling `members/route.ts` — the permission kernel RPCs come from a
 * migration not applied to production yet. */
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

type Params = { params: Promise<{ id: string; userId: string }> };

async function checkShareCapability(
  supabase: SupabaseClient,
  projectId: string,
  callerId: string
): Promise<NextResponse | null> {
  const { data: canShare, error: capError } = await supabase.rpc("has_project_access", {
    p_project_id: projectId,
    p_user_id: callerId,
    p_capability: "share",
  });
  if (capError) {
    if (isMissingFunctionError(capError)) {
      return NextResponse.json({ error: "Gestionar miembros todavía no está disponible." }, { status: 503 });
    }
    return NextResponse.json({ error: "No se pudo verificar el permiso." }, { status: 500 });
  }
  if (!canShare) {
    return NextResponse.json({ error: "No tenés permiso para gestionar miembros en este proyecto." }, { status: 403 });
  }
  return null;
}

/** `PATCH /api/projects/[id]/members/[userId]` — body `{ role: "admin" | "editor" | "viewer" }`. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: projectId, userId: targetUserId } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  if (!isValidInviteRole(body.role)) {
    return NextResponse.json({ error: "Elegí un rol válido: admin, editor o viewer." }, { status: 400 });
  }

  const capabilityError = await checkShareCapability(supabase, projectId, user.id);
  if (capabilityError) return capabilityError;

  const member = await getProjectMember(supabase, projectId, targetUserId);
  if (!member) {
    return NextResponse.json({ error: "No encontramos a esa persona en este proyecto." }, { status: 404 });
  }

  const validationError = resolveRoleChangeError({
    currentRole: member.role,
    isSelf: targetUserId === user.id,
    newRole: body.role,
  });
  if (validationError) return NextResponse.json({ error: validationError }, { status: 403 });

  const result = await updateProjectMemberRole(supabase, projectId, targetUserId, body.role);
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "owner_protected" ? 403 : result.code === "not_ready" ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ member: result.member });
}

/** `DELETE /api/projects/[id]/members/[userId]` — removes a member from the project. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: projectId, userId: targetUserId } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const capabilityError = await checkShareCapability(supabase, projectId, user.id);
  if (capabilityError) return capabilityError;

  const member = await getProjectMember(supabase, projectId, targetUserId);
  if (!member) {
    return NextResponse.json({ error: "No encontramos a esa persona en este proyecto." }, { status: 404 });
  }

  const validationError = resolveRemovalError(member.role);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 403 });

  const result = await removeProjectMember(supabase, projectId, targetUserId);
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "owner_protected" ? 403 : result.code === "not_ready" ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
