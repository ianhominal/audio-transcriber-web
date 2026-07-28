-- ============================================================
--  Team Sharing — Slice 1b, Phase 1: `root_project_id` desnormalizado
--  (design.md ADR-02). Deuda heredada de 1a: el design preveía adelantarla ahí porque es
--  "estructura, no permisos", pero 1a no la entregó (ver openspec/changes/team-sharing/
--  tasks-1b.md, "Deuda heredada de 1a"). 1b la hereda como prerequisito real del kernel de
--  permisos de Phase 3, no como preferencia.
--
--  La RLS de `projects` corre POR FILA. Con `root_project_id` en la propia fila, la policy de
--  lectura hace un solo `has_root_access` sin volver a consultar `projects` (I-4, cero recursión
--  estructural) y con costo CONSTANTE, independiente de cuán anidado esté el árbol del usuario
--  (ver design.md §3 ADR-02 para el argumento completo de performance/varianza — el trade-off es
--  "escritura rara [reparent], lectura calientísima [pull cada 60s] → desnormalizar").
-- ============================================================

alter table public.projects add column if not exists root_project_id uuid;

-- Mantiene `root_project_id` al día en cada alta/reparent. Guard de ciclo explícito en la base
-- (no en la app): si el root resuelto fuera igual al propio id (reparentar bajo un descendiente
-- propio), aborta con excepción en vez de dejar una fila corrupta.
create or replace function public.set_project_root()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_project_id is null then
    new.root_project_id := new.id;
  else
    select p.root_project_id into new.root_project_id
      from public.projects p where p.id = new.parent_project_id;

    if new.root_project_id is null then
      raise exception 'parent project % has no resolved root', new.parent_project_id;
    end if;

    if new.root_project_id = new.id then
      raise exception 'reparenting project % would create a cycle', new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_project_root on public.projects;
create trigger trg_set_project_root
  before insert or update of parent_project_id on public.projects
  for each row execute function public.set_project_root();

-- Reparentar un subárbol propaga la nueva raíz a los descendientes. Dispara SOLO si la raíz
-- efectivamente cambió (`is distinct from`): el reparent es una operación RARA (Drive sync, mover
-- una carpeta a mano); la lectura es calientísima y no debe pagar este costo en el camino común.
create or replace function public.cascade_project_root()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.root_project_id is distinct from old.root_project_id then
    with recursive sub as (
      select id from public.projects where parent_project_id = new.id
      union all
      select p.id from public.projects p join sub s on p.parent_project_id = s.id
    )
    update public.projects set root_project_id = new.root_project_id
     where id in (select id from sub);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cascade_project_root on public.projects;
create trigger trg_cascade_project_root
  after update on public.projects
  for each row execute function public.cascade_project_root();

create index if not exists projects_root_idx on public.projects (root_project_id);

-- Backfill: el trigger de arriba solo cubre altas/updates futuros. Las filas existentes se
-- resuelven una única vez con un WITH RECURSIVE que camina el árbol desde cada raíz (proyectos
-- sin `parent_project_id`) hacia sus descendientes.
with recursive resolved as (
  select id, id as computed_root
  from public.projects
  where parent_project_id is null

  union all

  select p.id, r.computed_root
  from public.projects p
  join resolved r on p.parent_project_id = r.id
)
update public.projects p
set root_project_id = resolved.computed_root
from resolved
where p.id = resolved.id
  and p.root_project_id is distinct from resolved.computed_root;

-- Recién acá se puede exigir NOT NULL: antes del backfill, toda fila existente tenía la columna
-- en null (el `add column` de arriba no tiene default).
alter table public.projects alter column root_project_id set not null;
