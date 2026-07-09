import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { getUserSettings, upsertUserSettings, type TranscriptionDefaults } from "@/lib/settings/user-settings";
import { resolveEngine, resolveLanguage, resolveQuality } from "@/lib/settings/validate";

export const runtime = "nodejs";

/** Defaults persistentes de transcripción del usuario logueado (web cookies o Bearer desktop). */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }
  const settings = await getUserSettings(supabase, user.id);
  return NextResponse.json(settings);
}

/**
 * Upsert parcial de los defaults. Body: subconjunto de `{ engine, quality, language }` — cada
 * campo se valida contra su allowlist (nunca se persiste tal cual lo que manda el cliente, mismo
 * criterio que `resolveGroqModel` en `/api/transcribe`).
 */
export async function PUT(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const patch: Partial<TranscriptionDefaults> = {};
  if ("engine" in body) patch.engine = resolveEngine(body.engine);
  if ("quality" in body) patch.quality = resolveQuality(body.quality);
  if ("language" in body) patch.language = resolveLanguage(body.language);

  try {
    const settings = await upsertUserSettings(supabase, user.id, patch);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo guardar la preferencia." },
      { status: 500 }
    );
  }
}
