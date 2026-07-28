-- ============================================================
--  Team Sharing — Slice 1b, Phase 2: `project_members` + owner materializado
--  (design.md ADR-01, spec "Membresía con owner materializado").
--
--  `projects.user_id` sigue siendo LA propiedad (única, inmutable, no transferible en Fase 1). El
--  owner se MATERIALIZA como una fila `project_members(role='owner')` vía trigger, sin
--  intervención de código de aplicación: los dos nunca divergen porque el segundo es derivado del
--  primero, no una fuente de verdad paralela.
-- ============================================================

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx
  on public.project_members (user_id, project_id);

-- Un único owner por proyecto, garantizado a nivel base (no por convención de código de
-- aplicación): el índice parcial hace que "dos owners" sea imposible de insertar.
create unique index if not exists project_members_single_owner_idx
  on public.project_members (project_id) where role = 'owner';

-- El owner se materializa solo. `INSERT ... ON CONFLICT DO UPDATE` NO dispara un AFTER INSERT en
-- el camino de update, así que el upsert de `/api/sync/push` sobre un proyecto existente no
-- duplica ni re-dispara nada acá.
create or replace function public.materialize_project_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role, granted_by)
  values (new.id, new.user_id, 'owner', new.user_id)
  on conflict (project_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists trg_materialize_project_owner on public.projects;
create trigger trg_materialize_project_owner
  after insert on public.projects
  for each row execute function public.materialize_project_owner();

-- El owner no se degrada ni se saca. Ni por bug, ni por endpoint, ni a mano (PostgREST directo).
create or replace function public.protect_project_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.role = 'owner' then
    raise exception 'the project owner cannot be removed';
  elsif tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'the project owner cannot be demoted';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_project_owner on public.project_members;
create trigger trg_protect_project_owner
  before update or delete on public.project_members
  for each row execute function public.protect_project_owner();

-- Backfill: los proyectos existentes no tienen fila materializada todavía (el trigger de arriba
-- solo corre para proyectos creados a partir de que esta migración se aplica).
insert into public.project_members (project_id, user_id, role, granted_by)
select id, user_id, 'owner', user_id
from public.projects
on conflict (project_id, user_id) do nothing;

-- RLS: se habilita acá (mismo paso que crea la tabla, patrón del resto del repo). La policy de
-- SELECT se agrega recién en la migración de Phase 3 porque depende de `has_project_access`
-- (todavía no existe en este punto) — ver esa migración para el porqué de esa policy, que es un
-- gap del checklist de tasks-1b.md (Phase 2/3 nunca la piden explícitamente y Phase 9.1 la
-- necesita). Hasta que esa policy exista, la tabla queda en deny-by-default (I-3): seguro, no
-- funcional todavía para lectura vía `authenticated`.
alter table public.project_members enable row level security;
