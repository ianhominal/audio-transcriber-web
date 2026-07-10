-- ============================================================
--  Log de uso de operaciones IA por usuario — cap de costo/abuso (auditoría 2026-07-10, hallazgo
--  MEDIUM #3: `/api/summarize` no tenía límite diario y `force: true` salteaba el cache, así que un
--  usuario podía loopear "Regenerar" sobre su propia transcripción sin límite y quemar la
--  GROQ_API_KEY compartida entre todos los usuarios).
--
--  Objetivo: registrar CADA llamada real al LLM (no las que se sirven desde cache) para poder
--  contar cuántas hizo un usuario en las últimas 24h y cortar al superar el cap — mismo criterio que
--  `DAILY_LIMIT` de transcripciones (src/lib/rateLimit.ts). A diferencia de ese caso, acá NO se
--  puede contar filas de `transcriptions` directamente: una regeneración con `force` reescribe la
--  MISMA fila (mismo `id`), no crea una nueva, así que hace falta un log de eventos aparte para
--  poder distinguir "1 resumen generado" de "10 regeneraciones del mismo resumen".
--
--  `kind` es genérico (no solo "summary") para poder reusar esta tabla si en el futuro se le agrega
--  un cap similar a otras operaciones IA (traducción, corrección con vocabulario) — hoy SOLO se
--  escribe desde `/api/summarize` (ver `src/lib/aiUsage.ts`), ningún otro endpoint la toca todavía.
--
--  `forced` distingue una regeneración explícita (botón "Regenerar" del detalle, `force: true`) de
--  la primera generación de un resumen — el cap de regeneraciones forzadas es más estricto (ver
--  `SUMMARY_FORCE_DAILY_LIMIT` en `src/lib/aiUsage.ts`) porque loopear `force` sobre la MISMA
--  transcripción ya cacheada es el vector de abuso puntual que motivó este fix.
--
--  Append-only por diseño: la app SOLO inserta y (vía trigger) cuenta filas — nunca actualiza ni
--  borra. Eso se refuerza a nivel RLS más abajo: hay policy de SELECT e INSERT, pero NO de UPDATE
--  ni DELETE (corrección del review adversarial 2026-07-10, CRÍTICO #1). Sin esa restricción un
--  usuario logueado podía pegarle directo a PostgREST (`DELETE .../ai_usage_log?user_id=eq.<suid>`)
--  y borrar su propio historial para resetear el contador → loop sin límite, rompiendo justo lo que
--  este fix cierra. El cascade de borrado de cuenta (`on delete cascade` desde `profiles`) NO pasa
--  por RLS (corre como sistema), así que no necesita una policy de DELETE.
-- ============================================================

create table if not exists public.ai_usage_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  forced     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Índice pensado para el conteo del cap (trigger de abajo): "cuántas filas de este usuario, de este
-- `kind`, en las últimas 24h" — `created_at desc` porque el conteo siempre filtra por una ventana
-- reciente.
create index if not exists ai_usage_log_user_kind_created_idx
  on public.ai_usage_log (user_id, kind, created_at desc);

-- ---------- Cap a nivel DB (trigger BEFORE INSERT) ----------
-- Corrección del review adversarial 2026-07-10 (WARNING #3): antes el cap se chequeaba con un
-- count-then-insert en la app, con una ventana TOCTOU del tamaño de un round-trip HTTP+app (dos
-- requests concurrentes cuentan 99 y ambos insertan). Moverlo al trigger reduce esa ventana a la de
-- un solo statement SQL dentro de la transacción del INSERT — mismo patrón exacto que
-- `enforce_vocabulary_term_limit` (ver `20260710120000_user_vocabulary.sql`). OJO: bajo el
-- aislamiento por defecto de Postgres (READ COMMITTED) esto NO es un candado duro — dos INSERTs
-- concurrentes del MISMO usuario todavía podrían ver ambos `count = 99` y colarse por uno o dos. Es
-- una cota de costo, no una frontera de seguridad: el sobre-conteo posible es de unas pocas unidades
-- y el límite se resetea en 24h. Si alguna vez hiciera falta cerrarlo del todo (acá y en vocabulario)
-- se agregaría un `pg_advisory_xact_lock(hashtext(new.user_id::text))` antes del conteo.
--
-- Enforcea DOS límites, ambos en ventana móvil de 24h:
--   - diario total de resúmenes (100) — token `ai_summary_daily_limit_reached`.
--   - regeneraciones forzadas (20) — token `ai_summary_force_daily_limit_reached`.
-- Los números DEBEN coincidir con `SUMMARY_DAILY_LIMIT` / `SUMMARY_FORCE_DAILY_LIMIT` en
-- `src/lib/aiUsage.ts`. Los tokens estables en el mensaje los detecta el route
-- (`isAiSummaryDailyLimitError` / `isAiSummaryForceLimitError`) para devolver un 429 con el texto en
-- español — nunca se reenvía el mensaje crudo al cliente, mismo criterio que vocabulario.
--
-- El conteo interno respeta RLS (el trigger corre SECURITY INVOKER, como `authenticated`): la policy
-- de SELECT de abajo scopea a `auth.uid() = user_id` y el trigger cuenta `where user_id = new.user_id`
-- (= auth.uid() en el INSERT), así que ve exactamente las filas del propio usuario — igual que el
-- trigger de vocabulario.
create or replace function public.enforce_ai_usage_summary_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  force_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  -- Hoy solo se capea 'summary'. Otros `kind` (futuros) pasan sin límite hasta que se decida uno.
  if new.kind <> 'summary' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'summary'
    and created_at >= window_start;

  if daily_count >= 100 then
    raise exception 'ai_summary_daily_limit_reached';
  end if;

  if new.forced then
    select count(*) into force_count
    from public.ai_usage_log
    where user_id = new.user_id
      and kind = 'summary'
      and forced = true
      and created_at >= window_start;

    if force_count >= 20 then
      raise exception 'ai_summary_force_daily_limit_reached';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_summary_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_summary_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_summary_limit();

-- ---------- Row Level Security (append-only: cada usuario VE e INSERTA solo lo suyo) ----------
alter table public.ai_usage_log enable row level security;

-- Se dropea también la policy `for all` de una posible corrida previa de esta migración en un
-- entorno de preview, para reemplazarla por las dos acotadas (SELECT + INSERT). Sin UPDATE ni
-- DELETE a propósito (ver comentario de cabecera, CRÍTICO #1).
drop policy if exists "own ai usage log" on public.ai_usage_log;
drop policy if exists "own ai usage log select" on public.ai_usage_log;
drop policy if exists "own ai usage log insert" on public.ai_usage_log;

create policy "own ai usage log select" on public.ai_usage_log
  for select using (auth.uid() = user_id);

create policy "own ai usage log insert" on public.ai_usage_log
  for insert with check (auth.uid() = user_id);
