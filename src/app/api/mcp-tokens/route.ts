import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { listMcpTokens, createMcpToken } from "@/lib/mcp-tokens/store";

export const runtime = "nodejs";

/** true if the parsed body is a plain JSON object (not `null`, not an array, not a primitive). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lists the user's MCP tokens (Settings → connect Claude/ChatGPT). Requires a session. Includes
 * revoked tokens ("Revoked" badge in the UI) — never `token_hash`, see `listMcpTokens`.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const tokens = await listMcpTokens(supabase, user.id);
  return NextResponse.json({ tokens });
}

/**
 * Creates a new MCP token. Body: `{ label?: string }`. Requires a session. Returns the RAW token
 * exactly once, in this same response (201) — it can never be recovered again afterwards.
 */
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

  const result = await createMcpToken(supabase, user.id, body.label);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.code === "limit" ? 400 : 500 });
  }
  return NextResponse.json(
    { id: result.id, label: result.label, created_at: result.created_at, token: result.token },
    { status: 201 }
  );
}
