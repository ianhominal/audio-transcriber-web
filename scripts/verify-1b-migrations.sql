-- ============================================================
--  Team Sharing — slice 1b: post-migration verification.
--
--  Run this in the Supabase SQL Editor AFTER pushing the slice 1b migrations
--  (20260728130000 .. 20260728210000). Every check prints PASS or FAIL with what it expected.
--
--  Why this exists: the Supabase↔GitHub integration sometimes skips a migration silently
--  (gotcha #8 in CLAUDE.md). We already hit the softer version of this with `version` — the
--  column existed but the triggers still had to be confirmed separately. A partially applied
--  permission kernel is far worse than a missing one: some policies live, some don't.
--
--  SAFE TO RUN: sections 1-3 are read-only. Section 4 runs real write attempts inside an
--  explicit transaction that always ROLLBACKs, so nothing it touches is persisted.
-- ============================================================

-- ---------- 1. Objects exist ----------
select 'columns' as check_group,
       case when count(*) = 3 then 'PASS' else 'FAIL' end as result,
       count(*) || '/3 found (projects.root_project_id, ai_usage_log.project_id, project_invites.status)' as detail
from information_schema.columns
where (table_name = 'projects'      and column_name = 'root_project_id')
   or (table_name = 'ai_usage_log'  and column_name = 'project_id')
   or (table_name = 'project_invites' and column_name = 'status');

select 'tables' as check_group,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as result,
       count(*) || '/2 found (project_members, project_invites)' as detail
from information_schema.tables
where table_schema = 'public' and table_name in ('project_members', 'project_invites');

select 'kernel functions' as check_group,
       case when count(*) = 5 then 'PASS' else 'FAIL' end as result,
       count(*) || '/5 found: ' || string_agg(proname, ', ' order by proname) as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('project_role_at_root', 'role_has_capability', 'has_root_access',
                  'has_project_access', 'accessible_project_ids');

select 'triggers' as check_group,
       case when count(*) >= 5 then 'PASS' else 'FAIL' end as result,
       count(*) || '/5 expected: ' || string_agg(tgname, ', ' order by tgname) as detail
from pg_trigger
where not tgisinternal
  and tgname in ('trg_set_project_root', 'trg_cascade_project_root',
                 'trg_freeze_project_ownership', 'trg_freeze_transcription_ownership',
                 'trg_materialize_project_owner');

select 'policies' as check_group,
       case when count(*) >= 9 then 'PASS' else 'FAIL' end as result,
       count(*) || ' policies on projects/transcriptions/project_members/project_invites' as detail
from pg_policies
where schemaname = 'public'
  and tablename in ('projects', 'transcriptions', 'project_members', 'project_invites');

select 'storage policy' as check_group,
       case when count(*) >= 1 then 'PASS' else 'FAIL' end as result,
       count(*) || ' shared-read policy on storage.objects' as detail
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT';

-- ---------- 2. Backfills actually ran ----------
-- These are the ones that hurt if skipped: without them, every owner loses sight of their own
-- projects the moment the new read policy goes live.
select 'backfill: root_project_id' as check_group,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' projects with a NULL root (must be 0)' as detail
from public.projects where root_project_id is null;

select 'backfill: owner membership' as check_group,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' projects without an owner row in project_members (must be 0)' as detail
from public.projects p
where not exists (
  select 1 from public.project_members m
  where m.project_id = p.id and m.user_id = p.user_id and m.role = 'owner'
);

-- ---------- 3. The capability matrix answers correctly ----------
select 'capability matrix' as check_group,
       case when public.role_has_capability('viewer', 'read')    is true
             and public.role_has_capability('viewer', 'write')   is false
             and public.role_has_capability('viewer', 'share')   is false
             and public.role_has_capability('editor', 'write')   is true
             and public.role_has_capability('editor', 'share')   is false
             and public.role_has_capability('admin',  'share')   is true
             and public.role_has_capability('owner',  'delete')  is true
             and public.role_has_capability(null,     'read')    is false
             and public.role_has_capability('owner',  'typo')    is false
       then 'PASS' else 'FAIL' end as result,
       'viewer reads but cannot write/share; unknown capability and null role both deny' as detail;

-- ---------- 4. Write guards actually block (always rolled back) ----------
-- Everything below happens inside a transaction that is rolled back, so no row is persisted.
begin;

do $$
declare
  v_user   uuid;
  v_parent uuid;
  v_child  uuid;
  v_blocked boolean;
begin
  select id into v_user from public.profiles limit 1;
  if v_user is null then
    raise notice 'SKIP: no profiles yet, cannot run write-guard checks';
    return;
  end if;

  insert into public.projects (user_id, name) values (v_user, '__verify_parent__') returning id into v_parent;
  insert into public.projects (user_id, name, parent_project_id)
    values (v_user, '__verify_child__', v_parent) returning id into v_child;

  -- (a) The child inherited the parent's root.
  if (select root_project_id from public.projects where id = v_child) = v_parent then
    raise notice 'PASS  inheritance: child resolved its root to the parent';
  else
    raise notice 'FAIL  inheritance: child root is %, expected %',
      (select root_project_id from public.projects where id = v_child), v_parent;
  end if;

  -- (b) Ownership cannot be handed to someone else.
  v_blocked := false;
  begin
    update public.projects set user_id = gen_random_uuid() where id = v_parent;
  exception when others then
    v_blocked := true;
  end;
  if v_blocked then
    raise notice 'PASS  ownership: rewriting user_id was rejected';
  else
    raise notice 'FAIL  ownership: user_id was rewritten — freeze trigger is NOT active';
  end if;

  -- (c) A project cannot be teleported into an unrelated tree.
  v_blocked := false;
  begin
    update public.projects set root_project_id = gen_random_uuid() where id = v_child;
  exception when others then
    v_blocked := true;
  end;
  if v_blocked then
    raise notice 'PASS  tree integrity: arbitrary root_project_id was rejected';
  else
    raise notice 'FAIL  tree integrity: root_project_id was rewritten to an unrelated tree';
  end if;

  -- (d) But legitimate reparenting still works, and cascades. This is the one that would break
  --     if the ownership guard had been written as a plain freeze instead of a consistency check.
  update public.projects set parent_project_id = null where id = v_child;
  if (select root_project_id from public.projects where id = v_child) = v_child then
    raise notice 'PASS  reparent: detaching the child made it its own root';
  else
    raise notice 'FAIL  reparent: child root is %, expected its own id %',
      (select root_project_id from public.projects where id = v_child), v_child;
  end if;

  -- (e) The owner row was materialized for the projects just created.
  if (select count(*) from public.project_members
      where project_id in (v_parent, v_child) and role = 'owner') = 2 then
    raise notice 'PASS  owner materialization: both new projects got an owner row';
  else
    raise notice 'FAIL  owner materialization: expected 2 owner rows for the new projects';
  end if;
end $$;

rollback;

-- ============================================================
--  Read the NOTICE output above for section 4. Anything FAIL means the corresponding migration
--  did not apply — re-run that file by hand in the SQL Editor before deploying the app code that
--  depends on it.
-- ============================================================
