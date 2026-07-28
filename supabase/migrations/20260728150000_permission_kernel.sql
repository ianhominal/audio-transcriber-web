-- ============================================================
--  Team Sharing — Slice 1b, Phase 3: kernel de permisos (design.md §2)
--
--  Las 5 funciones son EL núcleo de todo el cambio: `project_role_at_root` es el ÚNICO punto del
--  sistema que lee `project_members` directamente (regla de uso del design: ninguna policy llama
--  a `project_role_at_root` a mano, solo a través de `has_root_access`/`has_project_access`).
--  `role_has_capability` es el ÚNICO lugar donde un rol se convierte en un permiso (I-2): cero
--  mapeo rol→capability duplicado en TypeScript, en C# o en otra policy.
-- ============================================================

-- (1) EL PRIMITIVO. Lee UNA sola tabla. No conoce capabilities, no conoce jerarquía.
create or replace function public.project_role_at_root(p_root_project_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.project_members m
  where m.project_id = p_root_project_id
    and m.user_id    = p_user_id
  limit 1;
$$;

-- (2) LA MATRIZ. Único lugar del sistema donde un rol se convierte en un permiso.
-- Capability desconocida ⇒ `false` (no error): un typo en una policy nueva CIERRA el acceso en
-- vez de abrirlo (I-3, deny-by-default).
create or replace function public.role_has_capability(p_role text, p_capability text)
returns boolean
language sql
immutable
as $$
  select case
    when p_role is null then false
    when p_capability = 'read'    then p_role in ('owner', 'admin', 'editor', 'viewer')
    when p_capability = 'propose' then p_role in ('owner', 'admin', 'editor')
    when p_capability = 'write'   then p_role in ('owner', 'admin', 'editor')
    when p_capability = 'share'   then p_role in ('owner', 'admin')
    when p_capability = 'delete'  then p_role in ('owner', 'admin')
    else false
  end;
$$;

-- (3) ENTRADA PARA POLICIES SOBRE FILAS QUE YA CONOCEN SU RAÍZ (projects).
create or replace function public.has_root_access(p_root_project_id uuid, p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.role_has_capability(public.project_role_at_root(p_root_project_id, p_user_id), p_capability);
$$;

-- (4) ENTRADA GENERAL (Storage, endpoints, MCP): resuelve la raíz y delega.
create or replace function public.has_project_access(p_project_id uuid, p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_root_access(
           (select p.root_project_id from public.projects p where p.id = p_project_id),
           p_user_id, p_capability);
$$;

-- (5) LA INVERSA, para scopear listados sin duplicar reglas (pull, brain, MCP).
create or replace function public.accessible_project_ids(p_user_id uuid, p_capability text default 'read')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.projects p
  join public.project_members m on m.project_id = p.root_project_id
  where m.user_id = p_user_id
    and public.role_has_capability(m.role, p_capability);
$$;

-- ---------- project_members: policy de SELECT (gap del checklist de tasks-1b.md) ----------
-- Ninguna tarea de Phase 2/3 pide explícitamente la RLS de `project_members`, pero Phase 9.1 la
-- asume ("lista project_members del proyecto vía getApiUser + RLS") y sin esto la tabla queda
-- habilitada (Phase 2) pero sin ninguna policy: deny-by-default correcto pero INUTILIZABLE, ni
-- siquiera el propio owner podría leer su membresía vía el cliente `authenticated`. Se agrega acá,
-- no en Phase 2, porque depende de `has_project_access`, recién definida arriba. Solo SELECT: las
-- escrituras de membresía (invitar/aceptar/cambiar rol) son Phase 9, server-side, fuera de este
-- bloque SQL.
drop policy if exists "project_members: read" on public.project_members;
create policy "project_members: read" on public.project_members
  for select to authenticated
  using (public.has_project_access(project_id, (select auth.uid()), 'read'));
