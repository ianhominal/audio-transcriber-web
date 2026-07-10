import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { updateVocabularyTerm, deleteVocabularyTerm } from "@/lib/vocabulary/store";
import { sanitizeTerm } from "@/lib/vocabulary/validate";

export const runtime = "nodejs";

/** true si el body parseado es un objeto JSON plano (no `null`, no array, no primitivo). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Edita el texto de un término existente. Body: `{ term: string }`. Requiere sesión y ownership. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!isJsonObject(body)) {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const term = sanitizeTerm(body.term);
  if (!term) {
    return NextResponse.json({ error: "El término no puede estar vacío ni superar los 80 caracteres." }, { status: 400 });
  }

  const result = await updateVocabularyTerm(supabase, user.id, id, term);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code === "duplicate" ? 409 : 500 });
  }
  return NextResponse.json({ term: result.term });
}

/** Borra un término. Requiere sesión y ownership (scopeado a `user_id` además de RLS). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const result = await deleteVocabularyTerm(supabase, user.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
