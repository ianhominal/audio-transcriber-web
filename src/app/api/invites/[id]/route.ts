import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { acceptInvite, rejectInvite, cancelInvite } from "@/lib/invites/store";

export const runtime = "nodejs";

/** Team Sharing slice 1b, Phase 9.3/9.4. `POST { action }` resuelve la invitación del propio
 * invitado (aceptar/rechazar); `DELETE` la cancela (quien invitó, o quien tiene `share`). */

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `POST /api/invites/[id]` — body `{ action: "accept" | "reject" }`. Aceptar inserta
 * `project_members` + marca `accepted` en una transacción (`accept_project_invite` RPC, ver
 * migración `20260728210000_project_invites_accept_cancel.sql`); rechazar solo cambia `status`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  const action = isJsonObject(body) ? body.action : undefined;

  if (action === "accept") {
    const result = await acceptInvite(supabase, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    const result = await rejectInvite(supabase, id, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida. Usá 'accept' o 'reject'." }, { status: 400 });
}

/** `DELETE /api/invites/[id]` — cancela una invitación `pending`. El invitado NO necesita
 * actuar (spec "cancelar no requiere acción del invitado"); la RLS decide quién puede hacerlo. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const result = await cancelInvite(supabase, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 500 });
  }
  return NextResponse.json({ ok: true });
}
