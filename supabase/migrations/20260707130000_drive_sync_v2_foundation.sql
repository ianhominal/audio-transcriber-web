-- ============================================================
--  Drive-sync v2 — CIMIENTO de jerarquía (doc 10-diseno-drive-sync-v2.md)
--  - projects.parent_project_id: auto-referencia para subcarpetas → subproyectos.
--  - projects.sync_origin: marca qué proyectos cuelgan de Drive (para ACOTAR el motor).
--  - drive_folders: carpetas RAÍZ de Drive conectadas (N por usuario; antes 1 sola vía
--    drive_connections.root_folder_id, que queda deprecada pero se conserva por compat).
--  NO implementa importación recursiva ni Picker todavía (fases siguientes).
--  El cursor de changes.list SIGUE siendo por CUENTA de Google (drive_connections
--  .start_page_token), no por carpeta — Drive no ofrece un feed de cambios por carpeta.
-- ============================================================

-- ---------- projects: jerarquía + marca de origen ----------
alter table public.projects
  add column if not exists parent_project_id uuid references public.projects(id) on delete set null;

alter table public.projects
  add column if not exists sync_origin text not null default 'local';

create index if not exists projects_user_parent_idx
  on public.projects (user_id, parent_project_id);

-- ---------- drive_folders: carpetas raíz de Drive conectadas (N por usuario) ----------
-- Cada fila = una carpeta raíz de Drive elegida por el usuario ↔ un proyecto raíz local
-- (`sync_origin = 'drive'`). Las SUBcarpetas descubiertas al importar/sincronizar NO van acá:
-- se materializan como filas de `projects` con `parent_project_id` apuntando al proyecto
-- correspondiente, mapeadas en `drive_file_map` con `kind = 'project'` (esa columna ya existe
-- desde `20260707120000_drive_sync.sql`, hoy sin uso).
create table if not exists public.drive_folders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  drive_folder_id   text not null,
  local_project_id  uuid not null references public.projects(id) on delete cascade,
  name              text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, drive_folder_id)
);

alter table public.drive_folders enable row level security;

drop policy if exists "own drive folders" on public.drive_folders;
create policy "own drive folders" on public.drive_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_touch_drive_folders on public.drive_folders;
create trigger trg_touch_drive_folders
  before update on public.drive_folders
  for each row execute function public.touch_updated_at();

create index if not exists drive_folders_user_idx
  on public.drive_folders (user_id);
create index if not exists drive_folders_local_project_idx
  on public.drive_folders (local_project_id);
