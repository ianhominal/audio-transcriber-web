import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";

// Saneamos los valores de env: si al pegar la clave en el dashboard se coló un salto de línea
// o un espacio (pasa seguido con claves largas), el header HTTP queda inválido
// ("invalid header value"). La clave no tiene whitespace interno legítimo, así que lo quitamos todo.
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").replace(/\s/g, "");

/**
 * Cliente de Supabase con privilegios de service role: bypassea RLS por completo.
 *
 * Uso EXCLUSIVO para jobs de sistema (ej. cron de purga) que corren sin un usuario
 * logueado y necesitan operar sobre filas de todos los usuarios. NUNCA usar este
 * cliente para atender un request de un usuario final: al no aplicar RLS, cualquier
 * filtro mal armado en la query puede leer o borrar datos de otros usuarios.
 */
export function createServiceRoleClient(): SupabaseClient {
  return createServiceClient(URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
