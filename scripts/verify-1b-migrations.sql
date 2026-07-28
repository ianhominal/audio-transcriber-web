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

-- ---------- 1-3. Every static check, as ONE result set ----------
-- Deliberately a single UNION ALL rather than separate statements: the Supabase SQL Editor only
-- renders the LAST select of a script, so eight separate queries would silently show one result
-- and hide seven. Read every row — `ord` keeps them in a stable order.
select * from (
  select 1 as ord, 'columns' as check_group,
         case when count(*) = 3 then 'PASS' else 'FAIL' end as result,
         count(*) || '/3 (projects.root_project_id, ai_usage_log.project_id, project_invites.status)' as detail
  from information_schema.columns
  where (table_name = 'projects'        and column_name = 'root_project_id')
     or (table_name = 'ai_usage_log'    and column_name = 'project_id')
     or (table_name = 'project_invites' and column_name = 'status')

  union all
  select 2, 'tables',
         case when count(*) = 2 then 'PASS' else 'FAIL' end,
         count(*) || '/2 (project_members, project_invites)'
  from information_schema.tables
  where table_schema = 'public' and table_name in ('project_members', 'project_invites')

  union all
  select 3, 'kernel functions',
         case when count(*) = 5 then 'PASS' else 'FAIL' end,
         count(*) || '/5: ' || coalesce(string_agg(proname, ', ' order by proname), 'none')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and proname in ('project_role_at_root', 'role_has_capability', 'has_root_access',
                    'has_project_access', 'accessible_project_ids')

  union all
  select 4, 'triggers',
         case when count(*) >= 5 then 'PASS' else 'FAIL' end,
         count(*) || '/5: ' || coalesce(string_agg(tgname, ', ' order by tgname), 'none')
  from pg_trigger
  where not tgisinternal
    and tgname in ('trg_set_project_root', 'trg_cascade_project_root',
                   'trg_freeze_project_ownership', 'trg_freeze_transcription_ownership',
                   'trg_materialize_project_owner')

  union all
  select 5, 'policies',
         case when count(*) >= 9 then 'PASS' else 'FAIL' end,
         count(*) || ' on projects/transcriptions/project_members/project_invites (expected >= 9)'
  from pg_policies
  where schemaname = 'public'
    and tablename in ('projects', 'transcriptions', 'project_members', 'project_invites')

  union all
  select 6, 'storage policy',
         case when count(*) >= 1 then 'PASS' else 'FAIL' end,
         count(*) || ' SELECT policy on storage.objects'
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'

  -- The two backfills below are the ones that hurt most if skipped: without them every owner
  -- loses sight of their own projects the moment the new read policy goes live.
  union all
  select 7, 'backfill: root_project_id',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*) || ' projects with a NULL root (must be 0)'
  from public.projects where root_project_id is null

  union all
  select 8, 'backfill: owner membership',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*) || ' projects with no owner row in project_members (must be 0)'
  from public.projects p
  where not exists (
    select 1 from public.project_members m
    where m.project_id = p.id and m.user_id = p.user_id and m.role = 'owner'
  )

  union all
  select 9, 'capability matrix',
         case when public.role_has_capability('viewer', 'read')   is true
               and public.role_has_capability('viewer', 'write')  is false
               and public.role_has_capability('viewer', 'share')  is false
               and public.role_has_capability('editor', 'write')  is true
               and public.role_has_capability('editor', 'share')  is false
               and public.role_has_capability('admin',  'share')  is true
               and public.role_has_capability('owner',  'delete') is true
               and public.role_has_capability(null,     'read')   is false
               and public.role_has_capability('owner',  'typo')   is false
         then 'PASS' else 'FAIL' end,
         'viewer reads but cannot write/share; unknown capability and null role both deny'
) checks order by ord;

-- ============================================================
--  4. Do the write guards actually BLOCK? (run this block separately)
--
--  Section 1 proves the triggers EXIST. This one proves they WORK — a trigger can be installed
--  and still have a bug inside.
--
--  Results come back as a table, NOT as NOTICE messages: the Supabase SQL Editor has no message
--  pane, only Results and Chart, so anything raised with `raise notice` is invisible.
--
--  SAFE: every row it creates is written inside a transaction that is rolled back. The final
--  SELECT runs before the ROLLBACK, so you still see the results while nothing is persisted.
--  Select this whole block (from `begin;` to `rollback;`) and run it on its own.
-- ============================================================

begin;

create temp table _verify_results (ord int, check_group text, result text, detail text) on commit drop;

do $$
declare
  v_user    uuid;
  v_parent  uuid;
  v_child   uuid;
  v_actual  uuid;
  v_blocked boolean;
begin
  select id into v_user from public.profiles limit 1;
  if v_user is null then
    insert into _verify_results values (0, 'setup', 'SKIP', 'no profiles yet — nothing to test against');
    return;
  end if;

  insert into public.projects (user_id, name) values (v_user, '__verify_parent__') returning id into v_parent;
  insert into public.projects (user_id, name, parent_project_id)
    values (v_user, '__verify_child__', v_parent) returning id into v_child;

  -- (a) A subproject inherits its parent's root.
  select root_project_id into v_actual from public.projects where id = v_child;
  insert into _verify_results values (1, 'inheritance',
    case when v_actual = v_parent then 'PASS' else 'FAIL' end,
    'child root is ' || coalesce(v_actual::text, 'NULL') || ', expected the parent''s id');

  -- (b) Ownership cannot be handed to someone else.
  v_blocked := false;
  begin
    update public.projects set user_id = gen_random_uuid() where id = v_parent;
  exception when others then
    v_blocked := true;
  end;
  insert into _verify_results values (2, 'ownership guard',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then 'rewriting user_id was rejected'
         else 'user_id WAS rewritten — the freeze trigger is not doing its job' end);

  -- (c) A project cannot be teleported into an unrelated tree.
  v_blocked := false;
  begin
    update public.projects set root_project_id = gen_random_uuid() where id = v_child;
  exception when others then
    v_blocked := true;
  end;
  insert into _verify_results values (3, 'tree integrity',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then 'an arbitrary root_project_id was rejected'
         else 'root_project_id WAS rewritten to an unrelated tree' end);

  -- (d) And yet legitimate reparenting still works. This is the one that would break if the guard
  --     above had been written as a plain freeze instead of a consistency check.
  update public.projects set parent_project_id = null where id = v_child;
  select root_project_id into v_actual from public.projects where id = v_child;
  insert into _verify_results values (4, 'reparent still works',
    case when v_actual = v_child then 'PASS' else 'FAIL' end,
    'detached child root is ' || coalesce(v_actual::text, 'NULL') || ', expected its own id');

  -- (e) The owner row is materialized on creation.
  insert into _verify_results
  select 5, 'owner materialization',
         case when count(*) = 2 then 'PASS' else 'FAIL' end,
         count(*) || '/2 owner rows created for the two test projects'
  from public.project_members
  where project_id in (v_parent, v_child) and role = 'owner';
end $$;

select * from _verify_results order by ord;

rollback;
