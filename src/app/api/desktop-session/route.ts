import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { establishDesktopSession } from "@/lib/supabase/desktopSession";
import { clientIpFromHeaders, isDesktopSessionRateLimited } from "@/lib/desktopSessionRateLimit";

export const runtime = "nodejs";

// Real Supabase JWTs are well under 2KB. 4096 is a safe ceiling: this endpoint is unauthenticated,
// so without a max length a caller could send multi-MB strings that get parsed and handed to the
// Supabase SDK before any real auth check happens.
const bodySchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096),
});

/**
 * Recibe el par de tokens de Supabase que el cliente desktop ya tiene (el mismo que usa para sus
 * llamadas `Authorization: Bearer` de sync) y responde con las cookies de sesión reales de
 * Supabase (`Set-Cookie`), para que el desktop las copie al cookie jar de un WebView2 embebido
 * antes de navegar a una página como `/app/t/{id}` y esta quede ya logueada.
 *
 * Tokens SIEMPRE en el body (nunca en la URL/query string) para que no terminen en logs de acceso
 * ni en historiales de proxy. No hay CORS acá a propósito: esto lo llama un `HttpClient` nativo del
 * desktop, no JS de otro origen — agregar CORS solo ensancharía la superficie de ataque sin
 * necesidad.
 *
 * Sin auth previa: a diferencia de casi todo el resto de `api/*` (que arrancan con `getApiUser`),
 * este endpoint es alcanzable por cualquiera SIN sesión — es justamente su propósito, intercambiar
 * tokens por cookies. Cada intento (incluso con tokens garbage) cuesta un round-trip real contra
 * Supabase Auth (`getUser()` verifica siempre server-side, ver `desktopSession.ts`), así que además
 * de la validación de forma se aplica un rate-limit best-effort por IP (`desktopSessionRateLimit.ts`
 * — 20/min, en memoria, por instancia; NO es una garantía dura, ver el comentario de ese módulo).
 */
export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (isDesktopSessionRateLimited(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Probá de nuevo en un rato." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Faltan o son inválidos access_token/refresh_token." },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await establishDesktopSession(parsed.data.access_token, parsed.data.refresh_token);
  } catch (err) {
    console.error("[desktop-session] unexpected error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo iniciar la sesión." }, { status: 500 });
  }

  if (!result.ok) {
    // Nunca se llega a construir una respuesta con cookies para un token inválido/expirado: el
    // adapter de `@supabase/ssr` las bufferea en memoria dentro de `establishDesktopSession` y acá
    // simplemente no se leen si `ok` es `false` — no hay riesgo de filtrar un Set-Cookie parcial.
    return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  result.cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
  Object.entries(result.headers).forEach(([key, value]) => res.headers.set(key, value));
  return res;
}
