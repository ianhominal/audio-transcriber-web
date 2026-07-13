import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getApiUser } from "@/lib/supabase/api";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { sanitizeSearchQuery, isValidSearchQuery, buildIlikeOrFilter } from "@/lib/search/query";
import { pickBestSnippet } from "@/lib/search/snippet";
import { parseStoredSummary } from "@/lib/summary/format";

export const runtime = "nodejs";

const SEARCH_RESULT_LIMIT = 20;
const SELECT_COLUMNS = "id, title, audio_name, text, summary, created_at, project_id";

type NoteRow = {
  id: string;
  title: string | null;
  audio_name: string;
  text: string | null;
  summary: string | null;
  created_at: string;
  project_id: string | null;
};

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — full-text search across ALL of the user's
 * notes: `GET /api/notes/search?q=<query>`. Searches title + text + summary via Postgres full-text
 * search (`search_vector`, `spanish` config — see migration `20260713150000_search_vector.sql`),
 * scoped to the caller's own notes.
 *
 * OWNERSHIP — anti-IDOR: `.eq("user_id", user.id)` in ADDITION to RLS (defense in depth, same
 * criteria the brief calls out explicitly for this feature, matching `/api/notes/merge`'s header
 * comment). There is no id-based lookup here (no `.in("id", ...)` of caller-supplied ids like merge),
 * so the only thing that could ever widen the result set to someone else's notes would be a bug in
 * this scoping — RLS is still the real backstop even if this line were ever removed by mistake.
 *
 * Injection: the query text reaches Postgres only via `.textSearch(..., { type: "websearch" })`,
 * which Supabase sends as a BOUND PostgREST filter value (URL-encoded, never string-concatenated into
 * SQL) into `websearch_to_tsquery` — a function Postgres documents as accepting raw, unsanitized
 * search-engine-style input without ever raising a syntax error. `sanitizeSearchQuery` only caps
 * length/trims (cost defense, not an injection defense — there is no injection surface to defend
 * against here). The ILIKE fallback path (below) is the one that DOES need explicit escaping, since
 * `.or()` has its own comma/paren-sensitive mini-syntax — see `buildIlikeOrFilter`.
 *
 * No AI/Groq call happens in this route — full-text search is free, so there's no `ai_usage_log` cost
 * cap to enforce here (unlike `/api/brain`).
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const query = sanitizeSearchQuery(req.nextUrl.searchParams.get("q"));
  if (!isValidSearchQuery(query)) {
    return NextResponse.json({ results: [] });
  }

  const runFtsQuery = () =>
    supabase
      .from("transcriptions")
      .select(SELECT_COLUMNS)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .textSearch("search_vector", query, { type: "websearch", config: "spanish" })
      .order("created_at", { ascending: false })
      .limit(SEARCH_RESULT_LIMIT);

  const { data, error } = await runFtsQuery();

  if (!error) {
    return NextResponse.json({ results: buildResults(data as unknown as NoteRow[], query) });
  }

  if (!isMissingColumnError(error)) {
    console.error("[notes-search] query failed", { userId: user.id, error: error.message });
    Sentry.captureException(new Error(error.message || "Error al buscar notas."), {
      extra: { userId: user.id, stage: "notes-search-fts" },
    });
    return NextResponse.json({ error: "No se pudo buscar en tus notas." }, { status: 500 });
  }

  // `search_vector` (20260713150000_search_vector.sql) still not migrated in this environment —
  // rollout window, same criteria as every other `isMissingColumnError` fallback in this app.
  // Degrades to a plain `ilike` search over the same three fields, still scoped to `user_id` +
  // `deleted_at is null` — same ownership guarantee, just a cruder (accent/stemming-blind) match.
  const { data: fallbackData, error: fallbackError } = await supabase
    .from("transcriptions")
    .select(SELECT_COLUMNS)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .or(buildIlikeOrFilter(query, ["title", "text", "summary"]))
    .order("created_at", { ascending: false })
    .limit(SEARCH_RESULT_LIMIT);

  if (fallbackError) {
    console.error("[notes-search] ilike fallback failed", { userId: user.id, error: fallbackError.message });
    Sentry.captureException(new Error(fallbackError.message || "Error al buscar notas (fallback)."), {
      extra: { userId: user.id, stage: "notes-search-ilike-fallback" },
    });
    return NextResponse.json({ error: "No se pudo buscar en tus notas." }, { status: 500 });
  }

  return NextResponse.json({ results: buildResults(fallbackData as unknown as NoteRow[], query) });
}

function buildResults(rows: NoteRow[] | null, query: string) {
  return (rows ?? []).map((row) => {
    const summaryText = parseStoredSummary(row.summary)?.summary ?? null;
    return {
      id: row.id,
      title: row.title || "Sin título",
      createdAt: row.created_at,
      projectId: row.project_id,
      snippet: pickBestSnippet([row.text, summaryText, row.title], query),
    };
  });
}
