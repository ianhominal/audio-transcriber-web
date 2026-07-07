import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { signState } from "@/lib/crypto";
import { DRIVE_SCOPE, GOOGLE_AUTH_URL, driveCallbackUrl } from "@/lib/drive/oauth";

export const runtime = "nodejs";

/**
 * Arranca el flujo OAuth OFFLINE de Drive (distinto del export puntual con Google Identity
 * Services y distinto del login de Supabase): pide `access_type=offline` + `prompt=consent`
 * para garantizar un refresh_token que el backend pueda usar sin el usuario presente
 * (doc 09, Fase 1). Requiere sesión: es una navegación desde el botón "Conectar Google Drive".
 */
export async function GET(req: NextRequest) {
  const { user } = await getApiUser(req);
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !tokenKey) {
    return NextResponse.redirect(
      new URL("/app/ajustes?drive=config-missing", req.nextUrl.origin)
    );
  }

  // State firmado (HMAC): anti-CSRF + ata el callback al usuario que inició el flujo.
  // `nonce` evita que el mismo state se reutilice y `iat` permite expirarlo en el callback.
  const state = signState(
    { uid: user.id, nonce: randomBytes(12).toString("hex"), iat: Date.now() },
    tokenKey
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveCallbackUrl(req.nextUrl.origin),
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
