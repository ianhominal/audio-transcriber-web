-- ============================================================
--  Backend de sincronización (cliente desktop ↔ nube)
--  - Papelera (soft delete) recuperable para no perder datos.
--  - updated_at en transcriptions para "pull desde un timestamp" y last-write-wins.
--  - Triggers que mantienen updated_at al modificar.
-- ============================================================

-- updated_at en transcriptions (projects ya lo tiene).
alter table public.transcriptions
  add column if not exists updated_at timestamptz not null default now();

-- Papelera: deleted_at null = activo; con fecha = en papelera (purgable a los ~30 días).
alter table public.projects       add column if not exists deleted_at timestamptz;
alter table public.transcriptions add column if not exists deleted_at timestamptz;

-- Trigger genérico para mantener updated_at en cada UPDATE.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_projects on public.projects;
create trigger trg_touch_projects
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_transcriptions on public.transcriptions;
create trigger trg_touch_transcriptions
  before update on public.transcriptions
  for each row execute function public.touch_updated_at();

-- Índices para el "pull desde un timestamp" (sync incremental).
create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at);
create index if not exists transcriptions_user_updated_idx2
  on public.transcriptions (user_id, updated_at);
