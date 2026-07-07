import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { encryptSecret, verifyState } from "@/lib/crypto";
import { GOOGLE_TOKEN_URL, OAUTH_STATE_MAX_AGE_MS, driveCallbackUrl, type DriveOAuthState } from "@/lib/drive/oauth";

export const runtime = "nodejs";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function redirectAjustes(origin: string, status: string) {
  return NextResponse.redirect(new URL(`/app/ajustes?drive=${status}`, origin));
}

/**
 * Callback del flujo OAuth offline de Drive: canjea el `code` por tokens, guarda el
 * `refresh_token` CIFRADO en `drive_connections` y redirige de vuelta a Ajustes.
 *
 * Fundación de la Fase 1 (doc 09): NO crea la carpeta raíz ni el `start_page_token` todavía
 * (eso es Fase 2, motor de sync). Acá solo se garantiza la conexión reutilizable.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    // El usuario cerró el consent screen o denegó el permiso: no es un error de configuración.
    return redirectAjustes(origin, oauthError === "access_denied" ? "denied" : "error");
  }
  if (!code || !state) {
    return redirectAjustes(origin, "error");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) {
    return redirectAjustes(origin, "config-missing");
  }

  // El state prueba dos cosas: que lo emitimos nosotros (firma HMAC) y que no está vencido.
  const statePayload = verifyState<DriveOAuthState>(state, tokenKey);
  if (!statePayload || Date.now() - statePayload.iat > OAUTH_STATE_MAX_AGE_MS) {
    return redirectAjustes(origin, "invalid-state");
  }

  // Además del state, confirmamos que el usuario logueado AHORA es el mismo que arrancó el
  // flujo: evita que un callback ajeno (state robado/reenviado) escriba en la cuenta de otro.
  const { supabase, user } = await getApiUser(req);
  if (!user || user.id !== statePayload.uid) {
    return redirectAjustes(origin, "invalid-state");
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: driveCallbackUrl(origin),
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    return redirectAjustes(origin, "error");
  }

  const tokenData: GoogleTokenResponse = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || tokenData.error) {
    console.error("[drive/callback] error canjeando code por tokens:", tokenData.error, tokenData.error_description);
    return redirectAjustes(origin, "error");
  }

  if (!tokenData.refresh_token) {
    // `prompt=consent` debería forzar que Google siempre mande un refresh_token nuevo. Si no
    // llegó (caso raro), no hay nada útil para guardar: pedimos reconectar en vez de guardar
    // una conexión inservible (sin refresh_token no hay acceso offline).
    console.error("[drive/callback] Google no devolvió refresh_token pese a prompt=consent.");
    return redirectAjustes(origin, "no-refresh-token");
  }

  const refreshTokenEncrypted = encryptSecret(tokenData.refresh_token, tokenKey);

  const { error: dbError } = await supabase.from("drive_connections").upsert(
    {
      user_id: user.id,
      refresh_token_encrypted: refreshTokenEncrypted,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    console.error("[drive/callback] error guardando drive_connections:", dbError.message);
    return redirectAjustes(origin, "error");
  }

  return redirectAjustes(origin, "connected");
}
