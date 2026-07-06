import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión de Supabase en cada request y protege las rutas /app/*.
 * Sin sesión → redirect a /login.
 *
 * IMPORTANTE: al crear una respuesta nueva (redirect) hay que COPIAR las cookies
 * de `supabaseResponse`. Supabase rota el refresh token en cada refresco; si esa
 * cookie no viaja en el redirect, el navegador se queda con un token viejo y la
 * sesión se corta (el usuario "se desloguea solo").
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Crea un redirect preservando las cookies de sesión ya refrescadas.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
    return res;
  };

  const path = request.nextUrl.pathname;
  if (!user && path.startsWith("/app")) {
    return redirectTo("/login");
  }
  // Si ya está logueado y entra a /login, mandarlo al dashboard.
  if (user && path === "/login") {
    return redirectTo("/app");
  }

  return supabaseResponse;
}
