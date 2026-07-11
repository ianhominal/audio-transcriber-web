/**
 * Read-only MCP tool handlers exposed by `src/app/api/mcp/route.ts`. All real query logic lives
 * HERE — not in the route file — so it stays testable without any MCP protocol machinery and
 * cleanly auditable in one place for the security review (see `tools.test.ts`).
 *
 * Non-negotiable invariant: none of these functions accept a `user_id`/`userId` from `input`
 * (the tool-call arguments an MCP client controls). The acting user's id ALWAYS comes from
 * `userId`, the authenticated-context parameter resolved server-side from the bearer token (see
 * `src/lib/mcp/auth.ts`) — never from client-controlled input. Every function guards against a
 * falsy `userId` before touching Supabase at all.
 *
 * Every query runs against the service-role client (`src/lib/supabase/serviceRole.ts` — bypasses
 * RLS entirely, since there is no logged-in session for an MCP bearer token), so every single
 * query below filters explicitly by `.eq("user_id", userId)` — same discipline as
 * `src/app/api/cron/drive-sync/route.ts`, with zero exceptions. `getTranscription` in particular
 * filters by `id` AND `user_id` together in the SAME query — never fetch-by-id-then-check-owner
 * in application code, which would leave a window for a subtly wrong check to leak another
 * user's row.
 *
 * `audio_url` (or any signed/storage URL) is NEVER selected or returned by any tool here — MCP
 * exposes text + metadata only, by design (see the phase 1 task/changelog).
 *
 * Deliberately simple over clever: project-name resolution always runs as a SEPARATE query
 * scoped by the caller's own `user_id`, joined in application code — not a single query relying
 * on a Postgres FK-relationship join through the service-role client. Same reasoning extends to
 * `searchTranscriptions`: matching runs in application code against a `user_id`-scoped fetch
 * rather than a `.ilike()`/`.or()` filter string built from user input — fewer moving parts to
 * get wrong, easier for a reviewer to convince themselves there is no cross-user leak or filter
 * injection surface, at the cost of pulling more rows into memory than a hand-tuned DB-side query
 * would. Acceptable for this app's current scale (see other modules' MVP-first caps); a `pg_trgm`
 * index + `.ilike()`/`.or()` filter is a reasonable future optimization if usage grows.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;

/** Internal safety cap on how many of the user's own rows we ever pull into memory before
 * applying an in-app `search`/`query` filter and slicing to the caller-requested limit. Bounds
 * worst-case payload/latency for an account with a very large number of transcriptions; not a
 * security boundary (user_id scoping is what prevents cross-user access, not this cap). */
const LIST_FETCH_CAP = 500;
const SEARCH_FETCH_CAP = 200;

const TRANSCRIPTION_LIST_COLUMNS = "id, title, project_id, language, translated_to, summary, created_at";
const TRANSCRIPTION_DETAIL_COLUMNS =
  "id, title, description, text, language, project_id, translated_to, original_text, summary, created_at, updated_at";
const TRANSCRIPTION_SEARCH_COLUMNS = "id, title, description, text, project_id, created_at";

type TranscriptionListRow = {
  id: string;
  title: string;
  project_id: string | null;
  language: string;
  translated_to: string | null;
  summary: string | null;
  created_at: string;
};

type TranscriptionDetailRow = {
  id: string;
  title: string;
  description: string;
  text: string;
  language: string;
  project_id: string | null;
  translated_to: string | null;
  original_text: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type TranscriptionSearchRow = {
  id: string;
  title: string;
  description: string;
  text: string;
  project_id: string | null;
  created_at: string;
};

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

function unauthorizedResult(): CallToolResult {
  return textResult("Unauthorized: missing authenticated user context.", true);
}

/** Logs the real Supabase error server-side (console + Sentry, same pattern already used in
 * `src/app/api/sync/pull/route.ts`) and returns a generic, client-safe tool result. The raw
 * `error.message` (which can echo table/column names or other query internals) must never reach
 * an external MCP client — mirrors the no-raw-error-to-client rule already enforced by
 * `src/app/api/chat/route.ts`'s `onError`. */
function queryFailedResult(
  stage: string,
  userId: string,
  error: unknown,
  extra?: Record<string, unknown>
): CallToolResult {
  console.error(`[mcp/${stage}] query failed`, { userId, error, ...extra });
  Sentry.captureException(error, { extra: { userId, stage: `mcp-${stage}`, ...extra } });
  return textResult("Something went wrong while reading your transcriptions. Please try again.", true);
}

/** Falls back to a friendly placeholder — `title` can legitimately be an empty string (DB
 * default) if the user never set one; an empty title in a JSON blob read by an LLM client is
 * more confusing than a clear placeholder. */
function displayTitle(title: string): string {
  return title && title.trim() ? title : "Untitled";
}

/** `translated`/`summarized` are derived booleans, not the raw values — callers that need the
 * actual translated text or summary should follow up with `getTranscription`. */
function isTranslated(row: Pick<TranscriptionListRow, "translated_to">): boolean {
  return row.translated_to !== null && row.translated_to !== undefined;
}

function isSummarized(row: Pick<TranscriptionListRow, "summary">): boolean {
  return row.summary !== null && row.summary !== undefined;
}

/**
 * Clamps a caller-requested `limit` to `[1, MAX_LIST_LIMIT]`, defaulting to `DEFAULT_LIST_LIMIT`
 * when omitted. Pure — no I/O — so this cost-control policy is directly testable in isolation.
 */
export function clampLimit(requested: number | undefined | null): number {
  if (requested === undefined || requested === null || !Number.isFinite(requested)) {
    return DEFAULT_LIST_LIMIT;
  }
  const rounded = Math.floor(requested);
  if (rounded < 1) return 1;
  return Math.min(rounded, MAX_LIST_LIMIT);
}

/**
 * Builds a short snippet of `text` around the first case-insensitive occurrence of `query`
 * (with ellipses on whichever side got truncated), or falls back to a plain leading truncation
 * if `query` isn't found in `text` at all (e.g. the match came from `title`/`description`
 * instead). Pure — no I/O — used by `searchTranscriptions` to avoid ever returning full text.
 */
export function buildExcerpt(text: string, query: string, maxLength = 160): string {
  const source = text ?? "";
  if (!source) return "";

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  const matchIndex = lowerQuery ? lowerSource.indexOf(lowerQuery) : -1;

  if (matchIndex === -1) {
    const slice = source.slice(0, maxLength);
    return source.length > maxLength ? `${slice}…` : slice;
  }

  const contextBefore = Math.floor(maxLength * 0.3);
  const start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(source.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

/**
 * Fetches `{id -> name}` for the CALLER'S OWN projects only (`.eq("user_id", userId)`). Shared by
 * all three tools below instead of a per-tool query — one place to audit, and it means a
 * `project_id` that (however it happened — data drift, a future bug elsewhere) points at a
 * different user's project row simply fails to resolve a name instead of leaking it, because
 * that project id is never present in THIS map.
 */
async function fetchProjectNameMap(supabase: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("projects").select("id, name").eq("user_id", userId);
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  return new Map(rows.map((p) => [p.id, p.name]));
}

export type ListTranscriptionsInput = {
  projectId?: string;
  search?: string;
  limit?: number;
};

/**
 * Lists the caller's own transcriptions (metadata only, never `text`/`audio_url`). `search`, if
 * given, is a lightweight title-only filter (case-insensitive substring) — for matching against
 * the transcription body too, use `searchTranscriptions` instead.
 */
export async function listTranscriptions(
  supabase: SupabaseClient,
  userId: string,
  input: ListTranscriptionsInput
): Promise<CallToolResult> {
  if (!userId) return unauthorizedResult();

  let query = supabase
    .from("transcriptions")
    .select(TRANSCRIPTION_LIST_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (input.projectId) query = query.eq("project_id", input.projectId);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_FETCH_CAP);
  if (error) return queryFailedResult("list_transcriptions", userId, error);

  const rows = (data ?? []) as TranscriptionListRow[];
  const search = input.search?.trim().toLowerCase();
  const matched = search ? rows.filter((r) => r.title.toLowerCase().includes(search)) : rows;
  const limited = matched.slice(0, clampLimit(input.limit));

  const projectNameById = await fetchProjectNameMap(supabase, userId);

  return jsonResult(
    limited.map((row) => ({
      id: row.id,
      title: displayTitle(row.title),
      createdAt: row.created_at,
      project: row.project_id ? (projectNameById.get(row.project_id) ?? null) : null,
      language: row.language,
      translated: isTranslated(row),
      summarized: isSummarized(row),
    }))
  );
}

/**
 * Zod schema for `get_transcription`'s `id` input, exported (rather than defined inline in
 * `src/app/api/mcp/route.ts`) so it is directly unit-testable — Next.js route handlers may only
 * export HTTP method handlers plus a few reserved config names, so an inline schema there has no
 * seam a test could reach.
 *
 * `z.uuid()` — the current zod v4 top-level idiom; `z.string().uuid()` still exists but is
 * `@deprecated` in this zod version (verified against the installed `node_modules/zod` types) —
 * rejects a malformed id at the MCP protocol layer, BEFORE it ever reaches `getTranscription`/
 * Supabase. Without this, a malformed id used to reach Postgres and come back as an "invalid
 * input syntax for type uuid" error, which `queryFailedResult` then logs/Sentry-captures as an
 * unexpected exception for what is really just a client input mistake — noisy, and a different,
 * non-uniform error shape than the deliberate "not found" path below.
 */
export const TRANSCRIPTION_ID_SCHEMA = z
  .uuid()
  .describe("The transcription id, as returned by list_transcriptions or search_transcriptions.");

export type GetTranscriptionInput = {
  id: string;
};

/**
 * Returns the full detail (including `text`) of ONE transcription — the critical IDOR
 * checkpoint. The query filters by `id` AND `user_id` together in the SAME call, plus
 * `deleted_at is null` — never fetch-by-id and check ownership afterwards. A transcription that
 * doesn't exist and one that belongs to another user are INDISTINGUISHABLE from the caller's
 * point of view: both return the same clean "not found" `isError` result, never a thrown error
 * or a stack trace that could hint at which case it was.
 */
export async function getTranscription(
  supabase: SupabaseClient,
  userId: string,
  input: GetTranscriptionInput
): Promise<CallToolResult> {
  if (!userId || !input.id) return unauthorizedResult();

  const { data, error } = await supabase
    .from("transcriptions")
    .select(TRANSCRIPTION_DETAIL_COLUMNS)
    .eq("id", input.id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return queryFailedResult("get_transcription", userId, error, { transcriptionId: input.id });
  if (!data) return textResult("Transcription not found.", true);

  const row = data as TranscriptionDetailRow;
  let project: string | null = null;
  if (row.project_id) {
    const { data: projectRow } = await supabase
      .from("projects")
      .select("name")
      .eq("id", row.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    project = (projectRow as { name: string } | null)?.name ?? null;
  }

  return jsonResult({
    id: row.id,
    title: displayTitle(row.title),
    description: row.description,
    text: row.text,
    language: row.language,
    project,
    translatedTo: row.translated_to,
    originalText: row.original_text,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export type SearchTranscriptionsInput = {
  query: string;
  limit?: number;
};

/**
 * Full(er)-text search across the caller's own transcriptions: `title`, `text`, and
 * `description`, case-insensitive substring match. Returns a small excerpt per result, never the
 * full `text` — follow up with `getTranscription` for the complete content.
 */
export async function searchTranscriptions(
  supabase: SupabaseClient,
  userId: string,
  input: SearchTranscriptionsInput
): Promise<CallToolResult> {
  if (!userId) return unauthorizedResult();

  const query = input.query?.trim();
  if (!query) return jsonResult([]);
  const lowerQuery = query.toLowerCase();

  const { data, error } = await supabase
    .from("transcriptions")
    .select(TRANSCRIPTION_SEARCH_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(SEARCH_FETCH_CAP);

  if (error) return queryFailedResult("search_transcriptions", userId, error);

  const rows = (data ?? []) as TranscriptionSearchRow[];
  const matched = rows.filter(
    (r) =>
      r.title.toLowerCase().includes(lowerQuery) ||
      r.text.toLowerCase().includes(lowerQuery) ||
      r.description.toLowerCase().includes(lowerQuery)
  );
  const limited = matched.slice(0, clampLimit(input.limit));

  const projectNameById = await fetchProjectNameMap(supabase, userId);

  return jsonResult(
    limited.map((row) => ({
      id: row.id,
      title: displayTitle(row.title),
      createdAt: row.created_at,
      project: row.project_id ? (projectNameById.get(row.project_id) ?? null) : null,
      excerpt: buildExcerpt(row.text, query),
    }))
  );
}
