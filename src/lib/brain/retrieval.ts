import { sanitizeSearchQuery } from "@/lib/search/query";
import { MAX_BRAIN_CONTEXT_CHARS, RETRIEVAL_TOP_K, MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK } from "./config";

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — retrieval helpers. PURE module (no Supabase
 * call happens here): `buildRetrievalFilters` describes WHAT to query (so ownership is a small,
 * independently testable data shape instead of something buried inline in the route), and
 * `buildBrainContext` assembles the notes Supabase actually returned into the text block sent to the
 * model, capped the same way `combineNoteTexts` caps a merge (`src/lib/merge/validate.ts`).
 */

export type RetrievalFilters = {
  table: "transcriptions";
  /** ALWAYS the authenticated user's id — see the route's header comment: this value comes only from
   * `getApiUser(req)` (server-side session), never from the request body, so there is no input a
   * caller could supply to widen this filter to someone else's notes (no IDOR surface here). */
  userId: string;
  excludeDeleted: true;
  /** Sanitized (trimmed + length-capped) search text, ready for `websearch_to_tsquery`. */
  searchQuery: string;
  limit: number;
  /** Optional "Este proyecto" scope (chat scope "project"): when set, retrieval narrows to notes
   * inside this ONE project on top of the `userId` filter — it never replaces `userId`, only adds a
   * further `.eq("project_id", ...)` restriction within the caller's own already-scoped rows. Unlike
   * `userId`, this value is allowed to come from the request body (see the route's header comment):
   * a caller can only ever narrow their own notes with it, never widen or redirect the query to
   * another user's data, so it carries no IDOR risk on its own. */
  projectId?: string;
};

/**
 * Builds the retrieval filter descriptor for a Segundo cerebro question. `userId` MUST be the
 * authenticated user's id (see `RetrievalFilters.userId`) — this function doesn't read a user id from
 * `question` or anywhere else, so it can't be tricked into retrieving another user's notes no matter
 * what `question` contains. The route applies this descriptor as `.eq("user_id", filters.userId)`
 * (defense in depth ON TOP of RLS, same criteria the brief calls out explicitly for this feature).
 *
 * `projectId` is optional (chat scope "project" — "Este proyecto"): when provided, it's threaded
 * through unchanged into the returned filters so the route can additionally apply
 * `.eq("project_id", filters.projectId)`. Omitted/`undefined` preserves the original "Todas mis
 * notas" behavior byte-for-byte.
 */
export function buildRetrievalFilters(userId: string, question: string, projectId?: string): RetrievalFilters {
  return {
    table: "transcriptions",
    userId,
    excludeDeleted: true,
    searchQuery: sanitizeSearchQuery(question),
    limit: RETRIEVAL_TOP_K,
    ...(projectId ? { projectId } : {}),
  };
}

export type BrainSourceNote = {
  id: string;
  title: string;
  createdAt: string;
  text: string;
  summary: string | null;
};

export type BuildBrainContextResult = {
  contextText: string;
  usedNoteIds: string[];
  truncated: boolean;
};

/**
 * Combines the retrieved notes into a single text block to send as context to the model, capped at
 * `MAX_BRAIN_CONTEXT_CHARS` — same truncation strategy as `combineNoteTexts`
 * (`src/lib/merge/validate.ts`): concatenates whole blocks in order until the NEXT complete block
 * wouldn't fit, then stops (never adds a partial block), except when the very first note is already
 * larger than the cap on its own, in which case ITS text gets truncated so the result is never empty
 * just because one note is huge.
 *
 * Each note becomes a block `## {title} ({short ISO date})\n{text}\n\n`. Notes with no text but a
 * stored `summary` fall back to the parsed summary paragraph — the FTS retrieval that selected this
 * note may have matched on the summary/title (search_vector covers all three, see
 * `20260713150000_search_vector.sql`), so it can still be relevant context even if `text` is empty (a
 * short/text-only edited note). Notes with neither are skipped entirely (contribute nothing, same as
 * `combineNoteTexts`).
 *
 * `notes` is assumed already ordered the way the caller wants it presented (the route orders by
 * relevance/recency at the query level) — this function does not re-sort, unlike `combineNoteTexts`
 * (there the chronological order IS the point, for a document meant to read as one narrative; here
 * each note is an independent, separately-cited source, so preserving retrieval order matters more).
 */
export function buildBrainContext(notes: readonly BrainSourceNote[]): BuildBrainContextResult {
  if (notes.length === 0) return { contextText: "", usedNoteIds: [], truncated: false };

  let contextText = "";
  const usedNoteIds: string[] = [];

  for (const note of notes) {
    const body = note.text.trim() || parseSummaryFallback(note.summary);
    if (!body) continue;

    const shortDate = note.createdAt.slice(0, 10);
    const block = `## ${note.title || "Sin título"} (${shortDate})\n${body}\n\n`;

    if (contextText.length + block.length <= MAX_BRAIN_CONTEXT_CHARS) {
      contextText += block;
      usedNoteIds.push(note.id);
      continue;
    }

    if (usedNoteIds.length === 0) {
      const header = `## ${note.title || "Sin título"} (${shortDate})\n`;
      const footer = "\n\n";
      const availableForBody = Math.max(0, MAX_BRAIN_CONTEXT_CHARS - header.length - footer.length);
      contextText = header + body.slice(0, availableForBody) + footer;
      usedNoteIds.push(note.id);
    }

    return { contextText, usedNoteIds, truncated: true };
  }

  return { contextText, usedNoteIds, truncated: false };
}

/** Best-effort plain-text fallback when a note has no `text` but does have a stored `summary` (JSON,
 * see `src/lib/summary/format.ts`) — pulls just the `summary` paragraph, ignores `keyPoints`/
 * `actionItems` to keep this cheap and dependency-free (no need to import the full summary module for
 * one fallback path). `null`/invalid JSON/missing field all degrade to `""` (note contributes
 * nothing), never throws. */
function parseSummaryFallback(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { summary?: unknown };
    return typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  } catch {
    return "";
  }
}

/** true if the FTS retrieval returned fewer than `MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK` notes — the
 * route should also fetch the user's most recent notes as extra candidate context (see
 * `mergeWithRecentNotes`, and `MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK` in `./config` for why this is a
 * palliative for FTS, not a fix). */
export function shouldFetchRecentFallback(ftsResultCount: number): boolean {
  return ftsResultCount < MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK;
}

/**
 * Merges FTS retrieval results with the user's most recent notes as fallback candidate context when
 * FTS came back sparse (see `shouldFetchRecentFallback`). Returns `ftsNotes` FIRST, in their original
 * order, UNTOUCHED, followed by any `recentNotes` whose `id` is not already present in `ftsNotes`, in
 * the order `recentNotes` was given — so a note found by both never appears twice. No length/count cap
 * here on purpose: `buildBrainContext` already stops once `MAX_BRAIN_CONTEXT_CHARS` is reached, so
 * simply feeding it more candidates when FTS is sparse is enough; this is a candidate LIST, not the
 * final context, so it can't blow the cost cap.
 */
export function mergeWithRecentNotes(
  ftsNotes: readonly BrainSourceNote[],
  recentNotes: readonly BrainSourceNote[]
): BrainSourceNote[] {
  const seenIds = new Set(ftsNotes.map((note) => note.id));
  const extraNotes = recentNotes.filter((note) => !seenIds.has(note.id));
  return [...ftsNotes, ...extraNotes];
}
