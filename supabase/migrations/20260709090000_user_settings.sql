-- ============================================================
--  user_settings: defaults persistentes de transcripción (Motor/Calidad/Idioma).
--  Fase F1 — ver .claude/resources/ROADMAP.md ("Settings persistentes: Motor / Calidad / Idioma").
--  Fuente de verdad para web + desktop (perdura entre dispositivos); el cliente web además
--  cachea en localStorage para pintar sin flicker (ver src/lib/settings/local-cache.ts).
--
--  Nota de alcance: hoy la web SOLO transcribe con Groq (ver src/app/api/transcribe/route.ts) —
--  no hay selector de "Motor" en la UI web. `default_engine` igual se persiste acá para que el
--  esquema tenga paridad con el desktop (que sí soporta más de un motor) y quede listo para el
--  día que la web sume esa opción; por ahora el único valor válido es 'groq' (ver
--  src/lib/settings/validate.ts). Sumar un motor nuevo requiere una migración que amplíe el CHECK
--  de abajo, mismo criterio ya establecido en `drive_connections_status_check`
--  (20260707140000_drive_connection_status.sql).
-- ============================================================

create table if not exists public.user_settings (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  default_engine   text not null default 'groq',
  default_quality  text not null default 'whisper-large-v3-turbo',
  default_language text not null default 'es',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Allowlists a nivel DB — mismo criterio que `drive_connections_status_check`
-- (20260707140000_drive_connection_status.sql): defensa ante un write fuera de la app (dashboard,
-- script con service role) que la validación de `src/lib/settings/validate.ts` no puede cubrir.
-- Sumar un valor nuevo (ej. un segundo motor) requiere una migración que reemplace el CHECK.
alter table public.user_settings
  drop constraint if exists user_settings_engine_check;
alter table public.user_settings
  add constraint user_settings_engine_check check (default_engine in ('groq'));

alter table public.user_settings
  drop constraint if exists user_settings_quality_check;
alter table public.user_settings
  add constraint user_settings_quality_check
    check (default_quality in ('whisper-large-v3', 'whisper-large-v3-turbo'));

alter table public.user_settings
  drop constraint if exists user_settings_language_check;
alter table public.user_settings
  add constraint user_settings_language_check check (default_language in ('es', 'en', 'auto'));

-- updated_at se mantiene solo en el server: reusa el trigger genérico ya establecido en
-- `20260706190000_sync_backend.sql` (mismo que usan `projects`/`transcriptions`/`drive_*`) en vez
-- de definir una función redundante.
drop trigger if exists trg_touch_user_settings on public.user_settings;
create trigger trg_touch_user_settings
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security (cada usuario ve/edita SOLO su propia fila) ----------
alter table public.user_settings enable row level security;

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
