-- ============================================================
--  Daily usage cap for "Merge several notes into one document" (feature 2026-07-13, see brief).
--
--  Fifth independent BEFORE INSERT trigger on `ai_usage_log`, same pattern as
--  `enforce_ai_usage_summary_limit` (20260710130000_ai_usage_log.sql),
--  `enforce_ai_usage_chat_limit` (20260710140000_chat_messages.sql),
--  `enforce_ai_usage_title_tags_limit` (20260711160000_transcription_tags.sql), and
--  `enforce_ai_usage_recipe_limit` (20260713120000_ai_recipes.sql): Postgres supports multiple
--  BEFORE INSERT triggers on the same table, each one keeping to its own `kind`.
--
--  This migration does NOT create any new table — it reuses `ai_usage_log`, already created by
--  `20260710130000_ai_usage_log.sql`.
--
--  The number (20) is STRICTER than `AI_RECIPE_DAILY_LIMIT` (50): merging notes combines SEVERAL
--  notes at once (up to 40,000 chars of input, see `MAX_MERGE_INPUT_CHARS` in
--  `src/lib/merge/validate.ts`), a call that's more expensive on average than applying a format to a
--  SINGLE transcription. MUST match `AI_MERGE_DAILY_LIMIT` in `src/lib/aiUsage.ts`. A rejection here
--  is never a bug — the endpoint (`/api/notes/merge`) responds with a friendly 429, never blocking
--  the rest of the app.
-- ============================================================

create or replace function public.enforce_ai_usage_merge_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  if new.kind <> 'merge' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'merge'
    and created_at >= window_start;

  if daily_count >= 20 then
    raise exception 'ai_merge_daily_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_merge_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_merge_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_merge_limit();
