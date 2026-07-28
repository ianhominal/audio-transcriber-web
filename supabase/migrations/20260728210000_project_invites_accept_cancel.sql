-- ============================================================
--  Team Sharing — Slice 1b, Phase 9.3/9.4: accept (transactional) + cancel (delete) of an invite
--
--  Gap in the literal Phase 7 checklist, needed by Phase 9's own wording: "aceptar inserta
--  project_members(role=invitado) + status='accepted' EN UNA TRANSACCIÓN". PostgREST/supabase-js
--  has no multi-table transaction primitive callable from the client — each `.insert()`/`.update()`
--  is its own implicit transaction — so the only way to guarantee the membership insert and the
--  status flip happen atomically is a single SECURITY DEFINER function whose body IS the
--  transaction. `project_members` deliberately has NO direct INSERT policy for `authenticated`
--  (I-3, deny-by-default, same rationale as the rest of the kernel): the only sanctioned way in is
--  through this function, which re-checks `invited_user_id = auth.uid()` and `status = 'pending'`
--  itself before writing anything — it does not trust its caller beyond that.
-- ============================================================

create or replace function public.accept_project_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.project_invites%rowtype;
begin
  select * into v_invite
  from public.project_invites
  where id = p_invite_id
    and invited_user_id = auth.uid()
    and status = 'pending'
  for update;

  if not found then
    raise exception 'invite not found or not pending';
  end if;

  insert into public.project_members (project_id, user_id, role, granted_by)
  values (v_invite.project_id, v_invite.invited_user_id, v_invite.role, v_invite.invited_by)
  on conflict (project_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;

  update public.project_invites
  set status = 'accepted', resolved_at = now()
  where id = p_invite_id;
end;
$$;

revoke all on function public.accept_project_invite(uuid) from public;
grant execute on function public.accept_project_invite(uuid) to authenticated;

-- Cancelar una `pending` (Phase 9.4): DELETE, no un cuarto valor de `status` — el check constraint
-- de `project_invites.status` solo admite pending/accepted/rejected (spec "Invitaciones modelo
-- GitHub", sin "cancelled"), y borrar la fila libera de una el índice único parcial para reinvitar
-- sin esperar un rechazo explícito. Quien invitó o quien tiene `share` puede cancelar; el invitado
-- NO necesita actuar (spec "Cancelar una pending y reinvitar tras un rechazo").
drop policy if exists "project_invites: delete" on public.project_invites;
create policy "project_invites: delete" on public.project_invites
  for delete to authenticated
  using (
    status = 'pending'
    and (invited_by = (select auth.uid())
         or public.has_project_access(project_id, (select auth.uid()), 'share'))
  );
