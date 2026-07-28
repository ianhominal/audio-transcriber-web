import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { listReceivedInvites, listSentInvites, attachProjectNames, attachInviteeEmails } from "@/lib/invites/store";

export const runtime = "nodejs";

/**
 * `GET /api/invites` — Team Sharing slice 1b, Phase 9.5 (ADR-13 "un solo contrato de servidor,
 * dos vistas"): sin `projectId` devuelve las invitaciones RECIBIDAS por el usuario actual; con
 * `?projectId=`, las ENVIADAS para ese proyecto (la RLS de `project_invites` ya restringe esa
 * vista a quien tiene `share`, I-8: lecturas, solo RLS). Cada invitación viaja con `project_name`
 * (`attachProjectNames`, service-role): sin esto, un invitado que todavía no aceptó no tiene forma
 * de leer el nombre del proyecto vía RLS (no tiene fila en `project_members` todavía), y tanto el
 * desktop como esta UI mostraban un UUID crudo. También viaja con `invitee_email`
 * (`attachInviteeEmails`) — la vista de invitaciones ENVIADAS necesita mostrar a QUIÉN se invitó,
 * no solo su `user_id`.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  const invites = projectId
    ? await listSentInvites(supabase, projectId)
    : await listReceivedInvites(supabase, user.id);

  const serviceClient = createServiceRoleClient();
  const invitesWithNames = await attachProjectNames(serviceClient, invites);
  const invitesWithEmails = await attachInviteeEmails(serviceClient, invitesWithNames);
  return NextResponse.json({ invites: invitesWithEmails });
}
