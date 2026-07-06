-- ============================================================
--  Audio Transcriber — esquema de base de datos (Fase 1 SaaS)
--  Correr en Supabase: SQL Editor → pegar → Run.
-- ============================================================

-- ---------- profiles (1 fila por usuario) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  plan       text not null default 'free',   -- free | pro (para el futuro)
  created_at timestamptz not null default now()
);

-- Crear el profile automáticamente al registrarse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- projects ----------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  title       text not null default '',
  description text not null default '',
  icon        text not null default '',       -- emoji o clave de icono
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- transcriptions ----------
create table if not exists public.transcriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  audio_name  text not null,
  audio_size  bigint not null default 0,
  audio_url   text,                            -- Fase 2: audio en Storage
  text        text not null default '',
  language    text not null default 'es',
  model       text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists transcriptions_user_created_idx
  on public.transcriptions (user_id, created_at desc);

-- ---------- Row Level Security (cada usuario ve SOLO lo suyo) ----------
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.transcriptions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transcriptions" on public.transcriptions;
create policy "own transcriptions" on public.transcriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
