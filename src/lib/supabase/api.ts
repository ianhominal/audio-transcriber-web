import { createClient as createTokenClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "./server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Contexto autenticado para API routes. Soporta dos modos:
 * - Web: sesión por cookies (Supabase SSR).
 * - Cliente desktop: header `Authorization: Bearer <jwt>` (token de Supabase).
 *
 * En ambos casos las queries respetan RLS como el usuario dueño del token/sesión.
 */
export async function getApiUser(
  req: Request
): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const auth = req.headers.get("authorization");

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const supabase = createTokenClient(URL, KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    return { supabase, user };
  }

  // Modo web: cookies.
  const supabase = await createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}
