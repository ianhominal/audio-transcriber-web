-- ============================================================
--  Team Sharing — Slice 1b, Phase 7: `project_invites` — modelo GitHub
--  (spec "Invitaciones modelo GitHub — solo a usuarios existentes, requieren aceptación";
--  CORRIGE design.md ADR-10 — el spec manda sobre este punto, ver openspec/changes/team-sharing/
--  tasks-1b.md cabecera: "Desviación deliberada spec vs. design (ADR-10)").
--
--  El design original de invitaciones usa `email + token_hash + link de aceptación`. El spec de
--  1b, ya corregido, pide el modelo GitHub: SIN email crudo persistido como clave de acceso, SIN
--  token, SIN link — el servidor resuelve el email a un `user_id` EXISTENTE en el momento de
--  invitar (Phase 9, fuera de este bloque SQL; si no hay cuenta con ese email, error explícito sin
--  crear fila). Por eso `invited_user_id` es `NOT NULL` desde el arranque (nunca hay una fila "en
--  el limbo" sin cuenta resuelta) y no hay columnas `email`/`token_hash`/`expires_at`.
--
--  La fila en `project_members` se crea SOLO al aceptar (Phase 9, una transacción), NUNCA al
--  invitar: mientras el estado es `pending`, la RLS de `projects`/`transcriptions` (Phase 5) trata
--  al invitado exactamente igual que a un desconocido — no hay ninguna fila de membresía de la
--  que colgarse.
-- ============================================================

create table if not exists public.project_invites (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  role            text not null check (role in ('admin', 'editor', 'viewer')),
  invited_by      uuid not null references public.profiles(id) on delete cascade,
  status          text not null check (status in ('pending', 'accepted', 'rejected')) default 'pending',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

-- Permite reinvitar después de un `rejected`: el índice único parcial solo mira las filas
-- `pending`, así que una fila `rejected` anterior no bloquea una invitación nueva al mismo user.
create unique index if not exists project_invites_pending_idx
  on public.project_invites (project_id, invited_user_id) where status = 'pending';

-- Cubre la vista "invitaciones que recibí" (Phase 9.5).
create index if not exists project_invites_invited_user_idx
  on public.project_invites (invited_user_id, status);

alter table public.project_invites enable row level security;

-- SELECT: visible para el propio invitado, y para quien tiene `share` en el proyecto (quien puede
-- invitar también puede ver el estado de las invitaciones que envió — vista "enviadas" de 9.5).
drop policy if exists "project_invites: read" on public.project_invites;
create policy "project_invites: read" on public.project_invites
  for select to authenticated
  using (
    invited_user_id = (select auth.uid())
    or public.has_project_access(project_id, (select auth.uid()), 'share')
  );

-- INSERT: requiere `share` en el proyecto (defensa en profundidad además de la validación
-- server-side de Phase 9, I-8). `invited_by` queda fijado a quien ejecuta el INSERT.
drop policy if exists "project_invites: insert" on public.project_invites;
create policy "project_invites: insert" on public.project_invites
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and public.has_project_access(project_id, (select auth.uid()), 'share')
  );

-- UPDATE (cambio de `status`): el propio invitado resuelve la suya (aceptar/rechazar); quien
-- invitó o tiene `share` puede cancelar una `pending`.
drop policy if exists "project_invites: update" on public.project_invites;
create policy "project_invites: update" on public.project_invites
  for update to authenticated
  using (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or public.has_project_access(project_id, (select auth.uid()), 'share')
  )
  with check (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or public.has_project_access(project_id, (select auth.uid()), 'share')
  );

-- Guard de integridad, agregado más allá del checklist literal de tasks-1b.md: la policy de
-- UPDATE de arriba no distingue QUÉ columna cambia, solo QUIÉN puede tocar la fila. Sin este
-- trigger, el propio invitado (que sí puede hacer UPDATE para aceptar/rechazar) podría reescribir
-- `role` en el mismo statement — por ejemplo subirse de `viewer` a `admin` — antes de que Phase 9
-- procese el accept, que confía en `project_invites.role` para decidir con qué rol crear la fila
-- de `project_members`. Cierra esa escalada de privilegio: solo alguien con `share` puede cambiar
-- `role`/`project_id`/`invited_by`/`invited_user_id`; cualquiera con permiso de UPDATE (incluido
-- el invitado) sigue pudiendo cambiar `status`/`resolved_at` libremente.
create or replace function public.protect_project_invite_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role
      or new.project_id is distinct from old.project_id
      or new.invited_by is distinct from old.invited_by
      or new.invited_user_id is distinct from old.invited_user_id)
     and not public.has_project_access(old.project_id, auth.uid(), 'share') then
    raise exception 'only an inviter with share access can change invite terms';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_project_invite_terms on public.project_invites;
create trigger trg_protect_project_invite_terms
  before update on public.project_invites
  for each row execute function public.protect_project_invite_terms();
