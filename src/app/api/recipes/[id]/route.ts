import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { updateRecipe, deleteRecipe, setDefaultRecipe } from "@/lib/recipes/store";
import { sanitizeName, sanitizeInstruction } from "@/lib/recipes/validate";

export const runtime = "nodejs";

/** true si el body parseado es un objeto JSON plano (no `null`, no array, no primitivo). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Edita un formato existente. Body: `{ isDefault: true }` para marcarlo como el default (desmarca
 * cualquier otro, ver `setDefaultRecipe`) — O `{ name, instruction }` para editar su contenido. Un
 * solo PATCH nunca hace las dos cosas a la vez (la UI manda un request por acción). Requiere sesión y
 * ownership.
 */
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

  if (body.isDefault === true) {
    const result = await setDefaultRecipe(supabase, user.id, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ recipe: result.recipe });
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

  const result = await updateRecipe(supabase, user.id, id, name, instruction);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ recipe: result.recipe });
}

/** Borra un formato. Requiere sesión y ownership (scopeado a `user_id` además de RLS). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const result = await deleteRecipe(supabase, user.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
