-- ============================================================
--  Team Sharing — Slice 1b: ownership columns are immutable (analysis CRÍTICO-3, design §4).
--
--  Why this exists: `projects: write` grants UPDATE to anyone holding the `write` capability
--  (owner, admin, editor). Row-level security decides WHICH ROWS you may update — it says nothing
--  about WHICH COLUMNS. Without this trigger, anyone with that capability can rewrite:
--
--    - `projects.user_id`        -> takes ownership away from the owner
--    - `projects.root_project_id`-> moves the project into a tree they control, granting themselves
--                                   every capability on it (privilege escalation)
--    - `transcriptions.user_id`  -> same theft, one level down
--
--  The design listed `freeze_row_owner` as a required trigger but it did not survive into any task,
--  so it is added here. It is also the guard the sync push has always needed: `/api/sync/push`
--  builds its upsert payload with `user_id: user.id`, so a shared row pushed by a non-owner would
--  otherwise silently change hands.
--
--  Ownership transfer is explicitly out of scope for Fase 1 (ADR-01). When it arrives it must be a
--  `SECURITY DEFINER` function that this trigger exempts deliberately, never a plain UPDATE.
-- ============================================================

--  On `root_project_id` specifically: it is NOT frozen, it is CONSTRAINED. Freezing it would break
--  reparenting, which is a legitimate, already-shipped operation — `set_project_root` recomputes the
--  root whenever `parent_project_id` changes, and `cascade_project_root` then propagates it to every
--  descendant. Both are honest writes to that column.
--
--  What must be impossible is setting it to an ARBITRARY value: pointing a row at a tree the caller
--  controls grants them every capability on it. So the rule is consistency, not immutability — a new
--  root is accepted only when it is exactly what the row's parent implies. Derived writes satisfy
--  that by construction; a hand-crafted UPDATE does not.
--
--  Trigger ordering matters here and is not accidental: Postgres fires BEFORE triggers in name
--  order, so `trg_freeze_project_ownership` runs before `trg_set_project_root`. During a reparent
--  the client never sends `root_project_id`, so this check sees it unchanged and stays out of the
--  way; `set_project_root` then computes the correct value afterwards. An attacker who *does* send
--  it is caught here, before anything else runs.
create or replace function public.freeze_project_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_root uuid;
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'projects.user_id is immutable (ownership transfer is not supported)'
      using errcode = 'check_violation';
  end if;

  if new.root_project_id is distinct from old.root_project_id then
    if new.parent_project_id is null then
      expected_root := new.id;
    else
      select p.root_project_id into expected_root
        from public.projects p where p.id = new.parent_project_id;
    end if;

    if new.root_project_id is distinct from expected_root then
      raise exception 'root_project_id must match the parent''s root (got %, expected %)',
        new.root_project_id, expected_root
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_freeze_project_ownership on public.projects;
create trigger trg_freeze_project_ownership
  before update on public.projects
  for each row execute function public.freeze_project_ownership();

create or replace function public.freeze_transcription_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'transcriptions.user_id is immutable'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_freeze_transcription_ownership on public.transcriptions;
create trigger trg_freeze_transcription_ownership
  before update on public.transcriptions
  for each row execute function public.freeze_transcription_ownership();
