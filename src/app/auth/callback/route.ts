import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Intercambia el código de OAuth (Google) por una sesión y redirige al dashboard. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/app`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
