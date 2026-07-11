-- ============================================================
--  Transcripciones — auto-título + auto-tags al transcribir (tanda 3 de quick wins, ver
--  ROADMAP.md / BRAINSTORM.md). Objetivo: matar el problema de notas indistinguibles ("Grabación
--  47") generando, al terminar de transcribir, un título corto + 3-5 tags de tema vía LLM (Groq
--  `llama-3.1-8b-instant`, misma infra que resumen/traducción/vocabulario, ver
--  src/lib/titleTags/groq.ts). Best-effort ESTRICTO: si esa llamada falla, tarda de más o se pasa
--  del cap, la transcripción se guarda IGUAL, sin título/tags (ver el try/catch dedicado en
--  src/app/api/transcribe/route.ts, paso 2.7) — nunca bloquea ni rompe la transcripción.
--
--  Modelo de datos: UNA columna nueva, `tags text[] not null default '{}'` — mismo criterio que
--  `title` (Fase 2, `20260706180000_transcription_title.sql`): no ameritaba una tabla aparte (no
--  hay historial de tags, es un array chico por fila). Default `'{}'` (nunca null) para que el
--  resto de la app pueda asumir siempre un array, sin chequeos de null desperdigados — mismo
--  criterio que `title` (`default ''`, nunca null).
--
--  `title` NO se toca acá (el auto-título pisa la MISMA columna existente, solo cuando el título
--  todavía es el mecánico por defecto — ver `isPlaceholderTitle` en src/lib/titleTags/validate.ts —
--  nunca un título que la usuaria haya escrito a mano).
--
--  Índice GIN para el filtro "notas con este tag" (`.contains("tags", [tag])` en
--  src/app/app/page.tsx) — sin esto cada filtro por tag sería un scan secuencial completo de la
--  tabla; con pocos usuarios hoy no es crítico, pero es gratis agregarlo ahora.
--
--  OJO: igual que el resto de las migraciones desde F1, esta vive en la branch/commit y se aplica
--  automática recién al pushear a `main` (integración Supabase↔GitHub). Hasta entonces la app
--  funciona igual sin ella: la columna es NUEVA (fallback `42703`, reusa `isMissingColumnError` de
--  src/lib/supabase/schema-compat.ts) — notas viejas y nuevas durante la ventana de rollout
--  simplemente no tienen tags, nunca rompe el guardado ni la lectura.
-- ============================================================

alter table public.transcriptions
  add column if not exists tags text[] not null default '{}';

create index if not exists transcriptions_tags_idx
  on public.transcriptions using gin (tags);

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre esta columna nueva — actúa a nivel de fila, no de columna (mismo razonamiento ya
-- verificado y dejado por escrito en `20260709200000_project_color.sql` / `20260709210000_translation.sql`
-- / `20260709220000_transcription_summary.sql`).

-- ---------- Cap de uso diario de título+tags (reusa ai_usage_log, kind = 'title_tags') ----------
-- Tercer trigger BEFORE INSERT sobre `ai_usage_log`, independiente de `enforce_ai_usage_summary_limit`
-- (`20260710130000_ai_usage_log.sql`) y `enforce_ai_usage_chat_limit`
-- (`20260710140000_chat_messages.sql`) — Postgres soporta múltiples triggers BEFORE INSERT sobre la
-- misma tabla, cada uno se queda con su propio `kind` y ignora el resto, así que no hace falta tocar
-- ninguna de las otras dos funciones/migraciones para agregar este cap. El número (100) DEBE
-- coincidir con `TITLE_TAGS_DAILY_LIMIT` en `src/lib/aiUsage.ts`. Más generoso que
-- `SUMMARY_DAILY_LIMIT` porque este paso corre AUTOMÁTICO en cada transcripción (no a pedido manual
-- como "Resumir"), así que en el uso normal se acerca más al límite diario de transcripciones
-- (`DAILY_LIMIT = 50`, src/lib/rateLimit.ts) — 100 deja margen de sobra sin ser, en la práctica, un
-- límite real para el uso normal de una sola cuenta. Mismo criterio de "cota de costo, no candado
-- duro bajo READ COMMITTED" documentado en el trigger de resumen — un rechazo acá NUNCA es un bug,
-- es el freno de costo funcionando: el caller (`/api/transcribe`) lo trata como cualquier otro "no
-- se pudo generar esta vez", nunca bloquea la transcripción.
create or replace function public.enforce_ai_usage_title_tags_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  if new.kind <> 'title_tags' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'title_tags'
    and created_at >= window_start;

  if daily_count >= 100 then
    raise exception 'ai_title_tags_daily_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_title_tags_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_title_tags_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_title_tags_limit();
