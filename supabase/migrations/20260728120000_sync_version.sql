-- ============================================================
--  Team Sharing — Slice 1a (Identidad e integridad): `version` monotónico como único árbitro de
--  conflictos de sync (design.md ADR-07). Ver openspec/changes/team-sharing/design.md §3 ADR-07.
--
--  El reloj del cliente (`UpdatedAt`) NUNCA decide un ganador de conflicto — hoy `SyncPlanner`
--  compara mtime local contra `updated_at` remoto (dos relojes distintos, bug latente). A partir de
--  este slice, `version` es la única fuente: sube 1 en cada UPDATE, en el mismo trigger que ya
--  mantiene `updated_at`, así que un pull incremental (`updated_at > since`) nunca pierde un bump de
--  `version`.
--
--  `version` y el hash de contenido (`LastLocalHash`/`LastRemoteHash` en el desktop) responden
--  preguntas DISTINTAS: el hash detecta "cambió / no cambió"; `version` decide "el acto sigue siendo
--  seguro" (concurrencia optimista). No se reemplazan entre sí.
--
--  Retrocompatible, mismo patrón expand/contract que el resto del repo (ver
--  `src/lib/supabase/schema-compat.ts`, gotcha #8 de CLAUDE.md): esta migración se aplica sola al
--  pushear a `main` (integración Supabase↔GitHub), que a veces NO corre — hay que verificar a mano en
--  el SQL Editor tras el push (Phase 12.2 del plan de tareas).
--
--  IMPORTANTE: NO se toca `public.touch_updated_at()` — la siguen usando `drive_folders` y otras
--  tablas sin `version`. Se crea una función nueva, dedicada, y los triggers de `projects`/
--  `transcriptions` se reapuntan a ella.
-- ============================================================

alter table public.projects       add column if not exists version integer not null default 1;
alter table public.transcriptions add column if not exists version integer not null default 1;

create or replace function public.touch_updated_at_versioned()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version    := old.version + 1;  -- monotónico, server-side, único árbitro (ADR-07)
  return new;
end;
$$;

drop trigger if exists trg_touch_projects on public.projects;
create trigger trg_touch_projects
  before update on public.projects
  for each row execute function public.touch_updated_at_versioned();

drop trigger if exists trg_touch_transcriptions on public.transcriptions;
create trigger trg_touch_transcriptions
  before update on public.transcriptions
  for each row execute function public.touch_updated_at_versioned();

-- `public.touch_updated_at()` sigue existiendo tal cual, para el resto de las tablas
-- (`drive_folders`, etc.) que no tienen `version`.
