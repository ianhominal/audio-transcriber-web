import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { listProjectMembers, attachMemberEmails } from "@/lib/members/store";
import { resolveUserIdByEmail, createInvite } from "@/lib/invites/store";
import { isValidInviteRole, sanitizeEmail } from "@/lib/invites/validate";

export const runtime = "nodejs";

/** Team Sharing slice 1b, Phase 9 (design ADR-13, spec). `GET` lists membership; `POST` invites
 * by email. Both consumed identically by web and desktop (ADR-13: one server contract). */

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for Postgres "function does not exist" (`42883`) — same rationale as `store.ts`'s local
 * helper: the permission kernel RPCs come from a migration not applied to production yet. */
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

/** `GET /api/projects/[id]/members` — capability `read`. Lecture-only: no explicit capability
 * check here, RLS is the single source of truth for reads (I-8). Each member travels with
 * `email` (`attachMemberEmails`, service-role): `profiles` RLS only exposes a session's OWN row,
 * so without this the "quién es" column of the members UI would show nothing but raw `user_id`s
 * for everyone except the caller. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const members = await listProjectMembers(supabase, projectId);
  const membersWithEmail = await attachMemberEmails(createServiceRoleClient(), members);
  return NextResponse.json({ members: membersWithEmail });
}

/**
 * `POST /api/projects/[id]/members` — invita por email. Capability `share` se verifica ACÁ,
 * además de la RLS de `project_invites: insert` (I-8, defensa en profundidad en escritura). El
 * email se resuelve a un `user_id` EXISTENTE con service-role: `profiles` no es buscable por
 * email bajo la RLS de otro usuario (spec "Invitar a un email sin cuenta registrada": rechazo
 * explícito, sin crear ninguna fila).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });

  const email = sanitizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "Ingresá un email válido." }, { status: 400 });

  if (!isValidInviteRole(body.role)) {
    return NextResponse.json({ error: "Elegí un rol válido: admin, editor o viewer." }, { status: 400 });
  }

  // Cero lógica de permisos en TypeScript (I-2): la capability se resuelve SIEMPRE llamando a la
  // función SQL, nunca reimplementada acá.
  const { data: canShare, error: capError } = await supabase.rpc("has_project_access", {
    p_project_id: projectId,
    p_user_id: user.id,
    p_capability: "share",
  });
  if (capError) {
    if (isMissingFunctionError(capError)) {
      return NextResponse.json({ error: "Compartir proyectos todavía no está disponible." }, { status: 503 });
    }
    return NextResponse.json({ error: "No se pudo verificar el permiso." }, { status: 500 });
  }
  if (!canShare) {
    return NextResponse.json({ error: "No tenés permiso para invitar en este proyecto." }, { status: 403 });
  }

  const resolved = await resolveUserIdByEmail(createServiceRoleClient(), email);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.code === "not_found" ? 404 : 500 });
  }

  const result = await createInvite(supabase, {
    projectId,
    invitedUserId: resolved.userId,
    role: body.role,
    invitedBy: user.id,
  });
  if (!result.ok) {
    const status = result.code === "duplicate" ? 409 : result.code === "not_ready" ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ invite: result.invite }, { status: 201 });
}
