import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { listVocabularyTerms, addVocabularyTerm } from "@/lib/vocabulary/store";
import { sanitizeTerm } from "@/lib/vocabulary/validate";

export const runtime = "nodejs";

/** true si el body parseado es un objeto JSON plano (no `null`, no array, no primitivo). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lista el vocabulario custom del usuario (Ajustes → Vocabulario). Requiere sesión. */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const terms = await listVocabularyTerms(supabase, user.id);
  return NextResponse.json({ terms });
}

/** Agrega un término nuevo. Body: `{ term: string }`. Requiere sesión. */
export async function POST(req: NextRequest) {
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

  // El cap de cantidad (`MAX_VOCABULARY_TERMS`) lo garantiza de forma ATÓMICA un trigger BEFORE
  // INSERT en la DB (ver migración) — no un count-then-insert acá, que tendría una carrera TOCTOU
  // ante requests concurrentes. `addVocabularyTerm` traduce ese error del trigger a `code: "limit"`.
  const result = await addVocabularyTerm(supabase, user.id, term);
  if (!result.ok) {
    const status = result.code === "duplicate" ? 409 : result.code === "limit" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ term: result.term }, { status: 201 });
}
