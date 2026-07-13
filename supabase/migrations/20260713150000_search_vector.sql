-- ============================================================
--  "Segundo cerebro" (feature 2026-07-13, see brief) — full-text search across ALL of a user's
--  notes.
--
--  FREE MVP without a new embeddings provider: semantic search (embeddings/pgvector) is the natural
--  follow-up, documented in ROADMAP.md — it needs an embeddings provider (OpenAI/Cohere/Voyage/etc.),
--  a decision for the app owner, and a paid dependency this app doesn't have today. Postgres
--  full-text search is NATIVE to Supabase (no extension to enable), free, and good enough for "find
--  the note where I said X" over a personal note archive of this size.
--
--  `search_vector`: a GENERATED STORED column (not computed at query time) over
--  title + text + summary, using the `spanish` text search config — handles accent-folding and
--  Spanish stemming (e.g. a query for "reunión" also matches "reuniones"/"reunir"), which a plain
--  `ilike` never would. `summary` is the raw JSON string stored in `transcriptions.summary` (see
--  `20260709220000_transcription_summary.sql`) — including it as-is means a few JSON keys
--  ("summary", "keyPoints", "actionItems") get indexed as harmless noise tokens alongside the real
--  words inside the values, a fine trade-off for the MVP vs. parsing JSON in SQL.
--
--  `to_tsvector(regconfig, text)` (the TWO-argument form, with an explicit config) is IMMUTABLE in
--  Postgres — unlike the one-argument form, which depends on the session's `default_text_search_config`
--  GUC and is only STABLE. Passing `'spanish'` as a literal is what makes this expression legal in a
--  GENERATED ALWAYS AS (...) STORED column (Postgres rejects non-immutable expressions there).
--
--  Retrocompatible, same pattern as every other column added since F2 (see
--  `src/lib/supabase/schema-compat.ts`, `isMissingColumnError`): this migration applies automatically
--  only once merged to `main` (Supabase↔GitHub integration), so the app can be deployed/in preview
--  BEFORE the column exists in production. Both `/api/notes/search` and `/api/brain` fall back to an
--  `ilike`-based search when Postgres reports `42703` (column missing) instead of breaking.
-- ============================================================

alter table public.transcriptions
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'spanish',
      coalesce(title, '') || ' ' || coalesce(text, '') || ' ' || coalesce(summary, '')
    )
  ) stored;

create index if not exists transcriptions_search_vector_idx
  on public.transcriptions using gin (search_vector);

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre esta columna nueva — actúa a nivel de fila, no de columna (mismo razonamiento ya dejado
-- por escrito en 20260709200000_project_color.sql / 20260709210000_translation.sql /
-- 20260709220000_transcription_summary.sql).
