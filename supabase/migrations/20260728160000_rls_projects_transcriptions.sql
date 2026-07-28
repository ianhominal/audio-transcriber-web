-- ============================================================
--  Team Sharing — Slice 1b, Phase 5: RLS de `projects` y `transcriptions` sin recursión
--  (design.md §6, spec "RLS de projects y transcriptions sin recursión").
--
--  Reemplaza las policies `for all` basadas en `user_id` (creador = único que ve/escribe) por
--  policies acotadas por operación. SELECT y UPDATE de `projects` pasan a resolver por capability
--  vía `has_root_access` (I-4: la policy NO vuelve a consultar `projects`, `root_project_id` ya
--  está en la propia fila). SELECT de `transcriptions` agrega la rama de proyecto compartido; una
--  transcripción con `project_id IS NULL` (nota "General" del desktop) es privada por
--  construcción y nunca pasa por esa rama (ADR-01).
--
--  DESVIACIÓN documentada vs. el SQL literal de design.md §6: ese bloque solo muestra
--  "projects: read"/"projects: write" (UPDATE) y "transcriptions: read". Reemplazar la policy
--  `for all` existente por SOLO esas dejaría INSERT/DELETE de `projects` e INSERT/UPDATE/DELETE
--  de `transcriptions` sin NINGUNA policy — deny-by-default para TODOS, owner incluido: se
--  rompería crear proyectos, crear transcripciones, editarlas y borrarlas. Se agregan acá policies
--  explícitas que preservan el comportamiento actual (`auth.uid() = user_id`, creador = dueño de
--  la fila) para esas operaciones, sin tocar su semántica.
--
--  Esto también es lo que hace pasar al escenario del spec "Escritura de un viewer se rechaza":
--  la policy de UPDATE de `transcriptions` sigue exigiendo `user_id = auth.uid()`, así que un
--  viewer (que no es el `user_id` de la fila) ya queda afuera sin tocar nada más — habilitar
--  escritura compartida vía capability `write` para `transcriptions` es 1c (editor), explícitamente
--  fuera de este slice.
-- ============================================================

-- ---------- projects ----------
drop policy if exists "own projects" on public.projects;

-- The `user_id` branch is a deliberate safety net, not redundancy. Resolving reads purely through
-- membership makes every owner's access depend on the `project_members` backfill having run. These
-- migrations apply in sequence and this repo has a documented failure mode where the Supabase↔GitHub
-- integration silently skips one (gotcha #8): if the members migration is skipped and this one lands,
-- every user loses sight of their own projects. Owning the row is sufficient regardless — the same
-- shape `transcriptions: read` already uses below.
create policy "projects: read" on public.projects
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_root_access(root_project_id, (select auth.uid()), 'read')
  );

create policy "projects: write" on public.projects
  for update to authenticated
  using      (public.has_root_access(root_project_id, (select auth.uid()), 'write'))
  with check (public.has_root_access(root_project_id, (select auth.uid()), 'write'));

create policy "projects: insert" on public.projects
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "projects: delete" on public.projects
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- transcriptions ----------
drop policy if exists "own transcriptions" on public.transcriptions;

create policy "transcriptions: read" on public.transcriptions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (project_id is not null
        and public.has_project_access(project_id, (select auth.uid()), 'read'))
  );

create policy "transcriptions: insert" on public.transcriptions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "transcriptions: update" on public.transcriptions
  for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "transcriptions: delete" on public.transcriptions
  for delete to authenticated
  using ((select auth.uid()) = user_id);
