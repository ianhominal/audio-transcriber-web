-- ============================================================
--  Formatos (AI Recipes) — instrucciones reutilizables que el usuario guarda UNA vez y aplica con un
--  click a cualquier transcripción, en vez de re-escribir el mismo pedido en el chat cada vez. Ver
--  brief de la feature "Formatos" (2026-07-13).
--
--  Modelo de datos: tabla `ai_recipes`, UNA FILA POR FORMATO — mismo criterio que `vocabulary_terms`
--  (20260710120000_user_vocabulary.sql): el usuario mantiene una LISTA de longitud variable que edita
--  con frecuencia (agregar/editar/borrar formatos sueltos), así que una tabla por fila escala mejor
--  que una columna JSON/array en `user_settings`.
--
--  `is_default`: como mucho UN formato por usuario puede ser el default (el que se podría aplicar
--  automático al terminar de transcribir, ver ROADMAP/paso 8 del brief) — se garantiza con un índice
--  único PARCIAL (`where is_default`), no un boolean sin restricción. Para cambiar cuál es el default,
--  la app SIEMPRE hace dos UPDATE secuenciales (primero desmarcar el viejo, después marcar el nuevo —
--  ver `setDefaultRecipe` en `src/lib/recipes/store.ts`): si se invierte el orden, el índice parcial
--  rechaza el segundo UPDATE (dos filas con `is_default = true` a la vez).
--
--  FK a `public.profiles(id)`, NO a `auth.users(id)` — mismo criterio que `vocabulary_terms`/
--  `ai_recipes` hermanas (convención verificada del proyecto, no una elección nueva de esta migración).
--
--  Cap de cantidad (30 formatos/usuario): a diferencia de `vocabulary_terms` (100, con un trigger
--  BEFORE INSERT atómico en la DB), acá el cap vive SOLO en código de aplicación
--  (`MAX_RECIPES` en `src/lib/recipes/validate.ts`, `canAddRecipe`) — 30 es un techo bajo pensado para
--  UI (no hay riesgo real de abuso/costo por CANTIDAD de filas como sí lo hay con las LLAMADAS al LLM
--  al aplicar un formato, que sí tienen su propio cap atómico más abajo). Documentado acá para que
--  quede claro que la ausencia de trigger es una decisión, no un olvido.
--
--  OJO: igual que el resto de las migraciones desde F1, esta vive en el commit y se aplica automática
--  recién al pushear a `main` (integración Supabase↔GitHub). Hasta entonces: `ai_recipes` es tabla
--  NUEVA — cualquier lectura falla con "relation does not exist" (42P01, NO 42703), así que
--  `src/lib/recipes/store.ts` degrada por `isMissingTableError` (mismo criterio que
--  `vocabulary_terms`/`chat_messages`), no por el mecanismo de compat de columnas.
-- ============================================================

-- ---------- ai_recipes (N filas por usuario) ----------
create table if not exists public.ai_recipes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  instruction text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_recipes_user_created_idx
  on public.ai_recipes (user_id, created_at asc);

-- Cap de largo a nivel DB — defensa ante un write fuera de la app que la validación de
-- `src/lib/recipes/validate.ts` (MAX_NAME_LENGTH/MAX_INSTRUCTION_LENGTH) no puede cubrir, mismo
-- criterio que `vocabulary_terms_term_check`.
alter table public.ai_recipes
  drop constraint if exists ai_recipes_name_check;
alter table public.ai_recipes
  add constraint ai_recipes_name_check
    check (char_length(btrim(name)) > 0 and char_length(name) <= 80);

alter table public.ai_recipes
  drop constraint if exists ai_recipes_instruction_check;
alter table public.ai_recipes
  add constraint ai_recipes_instruction_check
    check (char_length(btrim(instruction)) > 0 and char_length(instruction) <= 2000);

-- Solo un formato default por usuario, ATÓMICO a nivel DB (índice único parcial) — ver comentario de
-- cabecera sobre el patrón de dos UPDATE secuenciales que la app debe respetar.
create unique index if not exists ai_recipes_one_default_per_user
  on public.ai_recipes (user_id) where (is_default);

-- updated_at se mantiene solo en el server: reusa el trigger genérico ya establecido en
-- `20260706190000_sync_backend.sql` (mismo que usan `projects`/`transcriptions`/`vocabulary_terms`).
drop trigger if exists trg_touch_ai_recipes on public.ai_recipes;
create trigger trg_touch_ai_recipes
  before update on public.ai_recipes
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security (cada usuario ve/edita SOLO sus propios formatos) ----------
alter table public.ai_recipes enable row level security;

drop policy if exists "own ai recipes" on public.ai_recipes;
create policy "own ai recipes" on public.ai_recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Cap de uso diario de "aplicar formato" (reusa ai_usage_log, kind = 'recipe') ----------
-- Cuarto trigger BEFORE INSERT sobre `ai_usage_log`, independiente de `enforce_ai_usage_summary_limit`
-- (20260710130000_ai_usage_log.sql), `enforce_ai_usage_chat_limit` (20260710140000_chat_messages.sql)
-- y `enforce_ai_usage_title_tags_limit` (20260711160000_transcription_tags.sql) — mismo patrón:
-- Postgres soporta múltiples triggers BEFORE INSERT sobre la misma tabla, cada uno se queda con su
-- propio `kind`. El número (50) DEBE coincidir con `AI_RECIPE_DAILY_LIMIT` en `src/lib/aiUsage.ts`.
-- Elegido a propósito ENTRE `TITLE_TAGS_DAILY_LIMIT` (100, automático en cada transcripción, salida
-- corta) y `CHAT_DAILY_LIMIT` (60, conversación abierta de ida y vuelta corta): aplicar un formato es
-- a pedido MANUAL (como el chat) pero con una salida más larga/costosa en promedio (un brief de
-- producción, una escaleta completa) que un mensaje de chat típico — por eso el techo queda un poco
-- por debajo del de chat. Un rechazo acá nunca es un bug, es el freno de costo funcionando: el
-- endpoint (`/api/recipes/apply`) responde 429 con un mensaje amigable, nunca bloquea el resto de la
-- app.
create or replace function public.enforce_ai_usage_recipe_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  if new.kind <> 'recipe' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'recipe'
    and created_at >= window_start;

  if daily_count >= 50 then
    raise exception 'ai_recipe_daily_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_recipe_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_recipe_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_recipe_limit();
