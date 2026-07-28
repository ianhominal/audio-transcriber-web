-- ============================================================
--  ROLLBACK de `20260728120000_sync_version.sql` (Team Sharing — slice 1a).
--
--  ESTO NO ES UNA MIGRACIÓN. Vive fuera de `supabase/migrations/` a propósito: es la marcha atrás
--  manual, para correr en el SQL Editor si el primer sync completo sale mal.
--
--  Por qué existe: el backup automático de la base es una feature paga. No hace falta pagarla para
--  esta migración puntual, porque el cambio es ADITIVO y por lo tanto reversible con SQL:
--    - agrega la columna `version` (no reescribe ni borra datos existentes),
--    - crea una función nueva (`touch_updated_at_versioned`),
--    - reapunta dos triggers que ya existían.
--  Nada de eso destruye información, así que deshacerlo devuelve el esquema al estado previo exacto.
--
--  LO QUE ESTE SCRIPT NO DESHACE: los cambios de DATOS que el sync haya hecho mientras la migración
--  estaba activa (filas nuevas, ids re-acuñados, duplicados). Para eso no hay rollback de esquema
--  que valga — de ahí que el orden de la Phase 12 sea mirar los diagnostics del primer sync ANTES
--  de dejarlo correr suelto.
-- ============================================================

-- 1) Restore the original triggers, pointing back at the shared function.
--    `touch_updated_at()` was never modified, so it is still there and still correct.
drop trigger if exists trg_touch_projects on public.projects;
create trigger trg_touch_projects
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_transcriptions on public.transcriptions;
create trigger trg_touch_transcriptions
  before update on public.transcriptions
  for each row execute function public.touch_updated_at();

-- 2) Drop the dedicated function added by the migration.
drop function if exists public.touch_updated_at_versioned();

-- 3) Drop the column. Do this LAST: while it exists, the deployed pull/push code can still read it,
--    so dropping it first would break requests during the window between steps.
--
--    SAFE even with the new web code deployed: `/api/sync/pull` degrades through the expand/contract
--    fallback (`PROJECT_COLUMNS_REDUCED` / `TRANSCRIPTION_COLUMNS_REDUCED` omit `version` on purpose)
--    and reports version 1 for every row instead of failing. That fallback is covered by
--    `src/app/api/sync/pull/route.test.ts`.
alter table public.transcriptions drop column if exists version;
alter table public.projects       drop column if exists version;

-- 4) Optional: remove the one-off audit helper, if it was left behind.
drop function if exists public.desktop_hash_id(text);
