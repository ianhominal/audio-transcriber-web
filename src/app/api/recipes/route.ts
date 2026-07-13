import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { listRecipes, createRecipe } from "@/lib/recipes/store";
import { sanitizeName, sanitizeInstruction, canAddRecipe } from "@/lib/recipes/validate";

export const runtime = "nodejs";

/** true si el body parseado es un objeto JSON plano (no `null`, no array, no primitivo). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lista los formatos del usuario (Ajustes → Formatos, y el selector del detalle). Requiere sesión. */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const recipes = await listRecipes(supabase, user.id);
  return NextResponse.json({ recipes });
}

/** Crea un formato nuevo. Body: `{ name: string, instruction: string }`. Requiere sesión. */
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

  const name = sanitizeName(body.name);
  if (!name) {
    return NextResponse.json({ error: "El nombre no puede estar vacío ni superar los 80 caracteres." }, { status: 400 });
  }
  const instruction = sanitizeInstruction(body.instruction);
  if (!instruction) {
    return NextResponse.json(
      { error: "Contá qué querés que haga con la nota (hasta 2000 caracteres)." },
      { status: 400 }
    );
  }

  // El cap de cantidad (`MAX_RECIPES`) NO tiene un trigger atómico en la DB (ver
  // `src/lib/recipes/validate.ts`) — se chequea acá contra un `listRecipes` fresco antes de insertar.
  const existing = await listRecipes(supabase, user.id);
  if (!canAddRecipe(existing.length)) {
    return NextResponse.json({ error: "Llegaste al máximo de 30 formatos." }, { status: 400 });
  }

  const result = await createRecipe(supabase, user.id, name, instruction);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ recipe: result.recipe }, { status: 201 });
}
