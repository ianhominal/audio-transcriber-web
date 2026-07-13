-- ============================================================
--  Daily usage cap for "Segundo cerebro" — chat across ALL of a user's notes (feature 2026-07-13,
--  see brief).
--
--  Sixth independent BEFORE INSERT trigger on `ai_usage_log`, same pattern as
--  `enforce_ai_usage_summary_limit` (20260710130000_ai_usage_log.sql),
--  `enforce_ai_usage_chat_limit` (20260710140000_chat_messages.sql),
--  `enforce_ai_usage_title_tags_limit` (20260711160000_transcription_tags.sql),
--  `enforce_ai_usage_recipe_limit` (20260713120000_ai_recipes.sql), and
--  `enforce_ai_usage_merge_limit` (20260713140000_ai_usage_merge.sql): Postgres supports multiple
--  BEFORE INSERT triggers on the same table, each one keeping to its own `kind`.
--
--  This migration does NOT create any new table — it reuses `ai_usage_log`, already created by
--  `20260710130000_ai_usage_log.sql`.
--
--  The number (30) sits BETWEEN `AI_MERGE_DAILY_LIMIT` (20) and `AI_RECIPE_DAILY_LIMIT` (50): each
--  brain question retrieves up to 8 notes and combines them into a context capped at 40,000 chars
--  (see `RETRIEVAL_TOP_K`/`MAX_BRAIN_CONTEXT_CHARS` in `src/lib/brain/config.ts`) — more expensive on
--  average than a single-transcription chat message (`CHAT_DAILY_LIMIT` = 60), but it's a MANUAL,
--  one-question-at-a-time action (not automatic like title+tags), and each request is genuinely
--  independent (no persisted history to pile up), so it doesn't need to be as strict as merging
--  several full notes into one document. MUST match `BRAIN_DAILY_LIMIT` in `src/lib/aiUsage.ts`. A
--  rejection here is never a bug — `/api/brain` responds with a friendly 429, never blocking the rest
--  of the app.
-- ============================================================

create or replace function public.enforce_ai_usage_brain_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  if new.kind <> 'brain' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'brain'
    and created_at >= window_start;

  if daily_count >= 30 then
    raise exception 'ai_brain_daily_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_brain_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_brain_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_brain_limit();
