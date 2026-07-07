-- ============================================================
--  Drive-sync — Fase 1: fundación (conexión OAuth offline + mapeo de archivos)
--  - drive_connections: refresh token cifrado + cursor de changes.list, por usuario.
--  - drive_file_map: identidad estable Drive fileId ↔ entidad local (proyecto/transcripción).
--  Motor de sync (Fase 2) y cron NO se implementan acá.
-- ============================================================

-- ---------- drive_connections (una fila por usuario) ----------
create table if not exists public.drive_connections (
  user_id                  uuid primary key references public.profiles(id) on delete cascade,
  refresh_token_encrypted  text not null,             -- refresh token cifrado (AES-256-GCM, ver src/lib/crypto.ts)
  start_page_token         text,                      -- cursor de changes.list (Fase 2, baseline se guarda acá)
  root_folder_id           text,                      -- fileId de la carpeta raíz sincronizada en Drive
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.drive_connections enable row level security;

drop policy if exists "own drive connection" on public.drive_connections;
create policy "own drive connection" on public.drive_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_touch_drive_connections on public.drive_connections;
create trigger trg_touch_drive_connections
  before update on public.drive_connections
  for each row execute function public.touch_updated_at();

-- ---------- drive_file_map (mapeo fileId de Drive ↔ entidad local) ----------
create table if not exists public.drive_file_map (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  drive_file_id  text not null,
  kind           text not null check (kind in ('project', 'transcription')),
  local_id       uuid not null,
  content_hash   text,                                -- hash del contenido subido/bajado (detectar cambios reales)
  deleted_at     timestamptz,                         -- tombstone: mapeo dado de baja
  updated_at     timestamptz not null default now(),
  unique (user_id, drive_file_id)
);

alter table public.drive_file_map enable row level security;

drop policy if exists "own drive map" on public.drive_file_map;
create policy "own drive map" on public.drive_file_map
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_touch_drive_file_map on public.drive_file_map;
create trigger trg_touch_drive_file_map
  before update on public.drive_file_map
  for each row execute function public.touch_updated_at();

create index if not exists drive_file_map_user_drive_idx
  on public.drive_file_map (user_id, drive_file_id);
create index if not exists drive_file_map_user_local_idx
  on public.drive_file_map (user_id, local_id);
