-- ============================================================
--  MCP tokens — opaque bearer credentials for the read-only remote MCP server (Phase 1, see
--  .claude/resources/changelog/2026-07-11.md). Lets a user mint a long-lived token from an
--  external MCP client (Claude Desktop, ChatGPT, etc.) that can list/search/read THEIR OWN
--  transcriptions over `/api/mcp` — text + metadata only, audio is never exposed.
--
--  Design: an OPAQUE token, NOT a Supabase JWT. `getApiUser` (src/lib/supabase/api.ts) only
--  understands real Supabase session JWTs, so this is a parallel auth mechanism scoped
--  exclusively to the MCP route (src/app/api/mcp/route.ts), verified with the service-role
--  client (bypasses RLS, so every query in the tool handlers MUST filter `user_id` explicitly —
--  see src/lib/mcp/tools.ts, same discipline as api/cron/drive-sync/route.ts). Only the
--  HMAC-SHA256 hash of the token is stored (`token_hash`, see src/lib/mcp/token.ts
--  `hashMcpToken`) — the raw token is shown to the user exactly once at creation time (Phase 2)
--  and cannot be recovered from the DB afterwards, same principle as a GitHub personal access
--  token.
--
--  Revocation is a SOFT delete (`revoked_at`) — no DELETE policy on purpose, same append-mostly
--  shape as `ai_usage_log`/`chat_messages` (20260710130000_ai_usage_log.sql,
--  20260710140000_chat_messages.sql): an audit trail of "this token existed and was used until
--  X" is more useful than letting the row disappear. `last_used_at` and the rate-limit window
--  columns are touched atomically by `check_and_touch_mcp_token` on every authenticated MCP call
--  (see below) — no `updated_at`/`touch_updated_at()` here, every mutable column already has its
--  own explicit meaning (unlike the generic "row changed" signal `touch_updated_at()` provides).
-- ============================================================

create table if not exists public.mcp_tokens (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  token_hash         text not null,
  label              text not null default 'MCP client',
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  rate_window_start  timestamptz not null default now(),
  rate_window_count  integer not null default 0
);

create unique index if not exists mcp_tokens_token_hash_key on public.mcp_tokens (token_hash);
create index if not exists mcp_tokens_user_id_idx on public.mcp_tokens (user_id);

-- ---------- Cap on ACTIVE tokens per user, atomic AND concurrency-safe (BEFORE INSERT trigger) ----------
-- Same stable-exception-string-token mechanism as `enforce_vocabulary_term_limit`
-- (20260710120000_user_vocabulary.sql): raises with a stable substring
-- (`mcp_token_limit_reached`) that Phase 2's token-creation API route can catch by
-- `error.message.includes(...)` — never by SQLSTATE — to return a clean 400. Running the
-- count-and-decide inside the INSERT's own trigger (not a separate count-then-insert round trip
-- from the app) rules out an app-level TOCTOU, but is NOT by itself safe against two DIFFERENT
-- concurrent transactions for the same user (two browser tabs, a double-click before the UI
-- disables the button, parallel requests): under READ COMMITTED, each transaction's own `select
-- count(*)` cannot see the other transaction's still-uncommitted INSERT, so both can read the
-- same pre-insert count, both pass `< 10`, and more than 10 active tokens land. The
-- `pg_advisory_xact_lock` call below closes that gap: it takes a per-user, transaction-scoped
-- advisory lock BEFORE counting, so a second concurrent INSERT for the same user blocks until the
-- first one's transaction ends (commit or rollback) — at which point the count it then reads is
-- guaranteed up to date. The lock auto-releases at transaction end, no manual unlock needed.
-- `hashtext(...)` collisions across different `user_id`s are harmless here (at most two unrelated
-- users briefly serialize against each other) because the count query itself is still scoped to
-- `new.user_id` — a collision can never inflate or deflate one user's count with another's rows.
--
-- UNLIKE vocabulary_terms (hard DELETE) or ai_usage_log/chat_messages (no user-facing revocation
-- at all), mcp_tokens is soft-delete only (see header comment) — counting ALL rows for this user
-- would turn the cap into a lifetime-creation limit that revoking a token could never free up.
-- So the count is scoped to ACTIVE tokens (`revoked_at is null`): revoking an old token always
-- frees a slot for a new one. The count runs SECURITY INVOKER (no `security definer`, same as
-- the vocabulary/ai_usage_log triggers) — if Phase 2's token-creation route inserts via the
-- normal RLS-scoped server client (the established pattern for every other user-initiated
-- mutation in this app, e.g. vocabulary/projects/chat), RLS additionally scopes the count to the
-- caller's own rows as defense in depth, exactly like `enforce_ai_usage_summary_limit` already
-- documents. The number (10) is intentionally generous for a read-only, low-blast-radius
-- credential (a handful of MCP clients per user).
create or replace function public.enforce_mcp_token_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  -- Per-user, transaction-scoped advisory lock — see comment above. Must run BEFORE the count so
  -- concurrent inserts for the same user serialize instead of racing on the same pre-insert count.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text)::bigint);

  select count(*) into active_count
  from public.mcp_tokens
  where user_id = new.user_id
    and revoked_at is null;

  if active_count >= 10 then
    raise exception 'mcp_token_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_mcp_token_limit on public.mcp_tokens;
create trigger trg_enforce_mcp_token_limit
  before insert on public.mcp_tokens
  for each row execute function public.enforce_mcp_token_limit();

-- ---------- Atomic rate-limit check + last-used touch (SECURITY DEFINER, service-role only) ----------
-- ONE UPDATE statement (not a SELECT-then-UPDATE from the app) so the read-modify-write is
-- atomic per row under Postgres's normal row-level locking — no TOCTOU window between reading
-- the current window/count and writing the new one, even under concurrent calls for the SAME
-- token. Both CASE branches read the OLD `rate_window_start` (UPDATE ... SET expressions in
-- Postgres always evaluate against the pre-update row), so the "did the window expire?" decision
-- is consistent across both assigned columns within the single statement — no risk of one column
-- deciding "expired" and the other deciding "still active". `RETURNING` reads the NEW
-- (post-update) `rate_window_count`, i.e. the count as it stands AFTER this call is included, so
-- the very request that pushes the count over `p_limit` is itself rejected.
--
-- If `p_token_id` matches no row (should not happen — the caller already resolved it via
-- `token_hash` — but defensive regardless), the UPDATE affects zero rows, `RETURNING` yields no
-- row, `v_allowed` stays NULL, and `coalesce(v_allowed, false)` fails closed. The explicit `and
-- revoked_at is null` in the `WHERE` clause below extends that same fail-closed path to a token
-- revoked in the narrow window between the caller's own SELECT (`resolveMcpAuth`, which already
-- checked `revoked_at`) and this RPC call for the SAME in-flight tool invocation: the UPDATE then
-- also affects zero rows, so a token revoked mid-request can never have its bookkeeping touched or
-- let one extra call complete — no other code change needed, `checkMcpRateLimit` in
-- `src/lib/mcp/auth.ts` already treats `!allowed` as unauthorized.
--
-- Called from `authorizeMcpToolCall` (`src/lib/mcp/auth.ts`), once per REAL tool invocation — NOT
-- from `resolveMcpAuth`/once per HTTP request anymore (CRITICAL fix, see
-- `.claude/resources/changelog/2026-07-11.md`: a single POST can carry a JSON-RPC BATCH of N tool
-- calls, so rate-limiting at the request level let a batch of N reads consume only ONE unit of
-- budget). This function's own atomicity (one UPDATE, row-level-locked) already made it safe to
-- call concurrently for the same token — that's exactly what a batch's N tool callbacks do, none
-- of them awaited between dispatches (confirmed by reading the installed SDK's
-- `webStandardStreamableHttp.js`).
--
-- `security definer` + a pinned `search_path` so the function can update `mcp_tokens` regardless
-- of caller — but it must NEVER be callable by an end user directly (they could pass an
-- arbitrary `p_token_id` and touch/reset bookkeeping on a token that is not theirs), so EXECUTE
-- is revoked from PUBLIC/anon/authenticated below and granted only to `service_role`, the only
-- intended caller (src/app/api/mcp/route.ts via `supabase.rpc(...)`). Postgres grants EXECUTE on
-- new functions to PUBLIC by default — without the explicit revoke, any logged-in user could
-- call this RPC directly and tamper with another user's token bookkeeping (not a data leak by
-- itself, since it only flips rate-limit counters, but entirely avoidable sloppiness).
create or replace function public.check_and_touch_mcp_token(
  p_token_id uuid,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  update public.mcp_tokens
  set
    rate_window_start = case
      when now() - rate_window_start > make_interval(secs => p_window_seconds) then now()
      else rate_window_start
    end,
    rate_window_count = case
      when now() - rate_window_start > make_interval(secs => p_window_seconds) then 1
      else rate_window_count + 1
    end,
    last_used_at = now()
  where id = p_token_id
    and revoked_at is null
  returning (rate_window_count <= p_limit) into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke execute on function public.check_and_touch_mcp_token(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.check_and_touch_mcp_token(uuid, integer, integer) to service_role;

-- ---------- Row Level Security ----------
-- SELECT + INSERT only for `authenticated` — deliberately NO UPDATE policy and NO UPDATE grant at
-- all (see below), and, same as before, NO DELETE policy — append-mostly shape, same as
-- `ai_usage_log`/`chat_messages`.
--
-- Revocation used to be exposed as a RLS-scoped, column-restricted UPDATE (`authenticated` could
-- PATCH only `revoked_at`, everything else rejected by a column-level GRANT). That closed a real
-- gap (a raw PostgREST PATCH resetting `rate_window_start`/`rate_window_count` to dodge the rate
-- limit) but left a SECOND one open: a column-level GRANT restricts WHICH column may be written,
-- never WHAT VALUE is written to it. Nothing stopped the token's owner from PATCHing `revoked_at`
-- on their own row from a real timestamp back to `null` — un-revoking (reactivating) a token they
-- (or whoever got hold of their session) had already revoked, in bulk, with a single raw
-- PostgREST request. CRITICAL fix (`.claude/resources/changelog/2026-07-11.md`): revocation is now
-- SERVER-SIDE ONLY. `authenticated` gets ZERO update privilege on this table — not even
-- `revoked_at` — so `revokeMcpToken` (`src/lib/mcp-tokens/store.ts`) now runs against the
-- SERVICE-ROLE client (bypasses RLS entirely, same as `src/lib/mcp/tools.ts`), called from
-- `src/app/api/mcp-tokens/[id]/route.ts` only after `getApiUser` has authenticated the caller's
-- own session — so this is still fully gated by a real session, just no longer routed through
-- PostgREST's row-scoped-but-column-writable UPDATE surface. `revokeMcpToken`'s own query keeps
-- its explicit `.eq("user_id", userId)` filter (defense in depth on top of "there's no RLS to fall
-- back on anymore for this call" — same IDOR discipline as `tools.ts`).
--
-- Belt-and-suspenders below the GRANT: the `enforce_mcp_token_revocation_immutable` trigger makes
-- "revoked is forever" true at the DATA layer too, independent of grants — see its own comment.
alter table public.mcp_tokens enable row level security;

drop policy if exists "own mcp tokens select" on public.mcp_tokens;
drop policy if exists "own mcp tokens insert" on public.mcp_tokens;
drop policy if exists "own mcp tokens update" on public.mcp_tokens;

create policy "own mcp tokens select" on public.mcp_tokens
  for select using (auth.uid() = user_id);

create policy "own mcp tokens insert" on public.mcp_tokens
  for insert with check (auth.uid() = user_id);

-- No "own mcp tokens update" policy anymore — see comment above. A RLS policy only decides WHICH
-- ROWS a statement may touch; Postgres checks table/column-level GRANTs BEFORE it ever evaluates
-- RLS, so with the UPDATE privilege revoked below, `authenticated` cannot reach an UPDATE on this
-- table at all, on ANY row, regardless of what a policy might say — a stale, never-effective
-- policy left in place would be actively misleading to a future reader. `anon` is revoked too,
-- purely for completeness (it was never granted UPDATE explicitly, and RLS `auth.uid() = user_id`
-- could never match an anonymous caller anyway — this is a zero-risk, zero-cost belt-and-suspenders
-- line, not a response to a real gap for that role).
revoke update on public.mcp_tokens from authenticated, anon;

-- ---------- Once revoked, a token row is FROZEN — no further UPDATE at all, from ANY role ----------
-- Second, independent layer for the SAME guarantee as the GRANT above ("revoked is forever"), at
-- the data layer instead of the privilege layer: once `old.revoked_at` is non-null, this trigger
-- rejects EVERY update to that row — reasserting the same value, changing it to another timestamp,
-- or moving it back to `null` — for ANY caller, `service_role` included. This is not redundant
-- busywork: the GRANT above is airtight only as long as no future migration ever accidentally
-- re-grants broader UPDATE to `authenticated` (an easy copy-paste mistake) — this trigger keeps
-- "a revoked token can never be reactivated" true even if that ever slips, because it doesn't
-- depend on who is allowed to attempt the UPDATE, only on what state the row is already in.
--
-- Both legitimate UPDATE paths on this table stay unaffected: `revokeMcpToken`
-- (`src/lib/mcp-tokens/store.ts`) only ever matches rows via its own `.is("revoked_at", null)`
-- filter, so `old.revoked_at` is always null when IT runs — never trips this trigger.
-- `check_and_touch_mcp_token` (above) has the same `and revoked_at is null` guarantee in its own
-- WHERE clause, for the same reason. Neither needs to change.
create or replace function public.enforce_mcp_token_revocation_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.revoked_at is not null then
    raise exception 'mcp_token_revocation_is_final';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_mcp_token_revocation_immutable on public.mcp_tokens;
create trigger trg_enforce_mcp_token_revocation_immutable
  before update on public.mcp_tokens
  for each row execute function public.enforce_mcp_token_revocation_immutable();
