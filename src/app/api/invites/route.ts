import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { listReceivedInvites, listSentInvites } from "@/lib/invites/store";

export const runtime = "nodejs";

/**
 * `GET /api/invites` — Team Sharing slice 1b, Phase 9.5 (ADR-13 "un solo contrato de servidor,
 * dos vistas"): sin `projectId` devuelve las invitaciones RECIBIDAS por el usuario actual; con
 * `?projectId=`, las ENVIADAS para ese proyecto (la RLS de `project_invites` ya restringe esa
 * vista a quien tiene `share`, I-8: lecturas, solo RLS).
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  const invites = projectId
    ? await listSentInvites(supabase, projectId)
    : await listReceivedInvites(supabase, user.id);

  return NextResponse.json({ invites });
}
