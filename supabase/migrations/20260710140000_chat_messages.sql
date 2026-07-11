-- ============================================================
--  Chat con IA sobre una transcripción puntual (MVP por-transcripción, ver ROADMAP.md). La usuaria
--  le pregunta a un LLM sobre EL TEXTO de una transcripción (resumir, extraer ideas, generar
--  contenido, responder preguntas) desde el detalle (`src/app/app/t/[id]/`).
--
--  Modelo de datos elegido: tabla `chat_messages`, UNA FILA POR MENSAJE (rol + contenido en texto
--  plano), NO el formato `UIMessage` completo (con `parts`) del AI SDK — guardamos el texto ya
--  extraído de los `parts` (ver `src/lib/chat/messages.ts`, `extractUiMessageText`). Se eligió texto
--  plano en vez de JSON de `parts` porque este MVP es solo texto (sin tools, adjuntos ni metadata) y
--  un `content text` simple es más fácil de auditar/migrar que replicar el schema interno del SDK
--  (que puede cambiar entre versiones) — mismo criterio de "guardar lo mínimo estable" que
--  `summary`/`summary_source_hash` en vez de la respuesta cruda de Groq.
--
--  Igual que `vocabulary_terms`/`ai_usage_log`: tabla NUEVA, se aplica automática recién al pushear a
--  `main` (integración Supabase↔GitHub) — el endpoint (`src/app/api/chat/route.ts`) y la carga de
--  historial (`src/app/app/t/[id]/page.tsx`) degradan con `isMissingTableError` durante la ventana de
--  rollout (historial vacío / mensajes no persistidos, el chat sigue funcionando).
--
--  Cap de costo/abuso: NO se agrega un cap propio acá — se reusa `ai_usage_log` (kind: 'chat') con un
--  segundo trigger `BEFORE INSERT` independiente del de `summary` (ver más abajo), mismo patrón
--  reserve-on-attempt que `/api/summarize` (insertar en `ai_usage_log` ANTES de llamar a Groq).
-- ============================================================

-- ---------- chat_messages (N filas por transcripción, todas del mismo dueño) ----------
create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  transcription_id  uuid not null references public.transcriptions(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  role              text not null,
  content           text not null,
  created_at        timestamptz not null default now()
);

alter table public.chat_messages
  drop constraint if exists chat_messages_role_check;
alter table public.chat_messages
  add constraint chat_messages_role_check check (role in ('user', 'assistant'));

-- Cap de largo a nivel DB — defensa en profundidad además de `MAX_CHAT_MESSAGE_CHARS`
-- (`src/lib/chat/config.ts`, mensajes del usuario) y `CHAT_MAX_OUTPUT_TOKENS` (respuestas del
-- modelo): un valor generoso que cubre el peor caso legítimo (una respuesta larga del LLM) sin
-- permitir una fila arbitrariamente grande ante un write fuera de la app.
alter table public.chat_messages
  drop constraint if exists chat_messages_content_check;
alter table public.chat_messages
  add constraint chat_messages_content_check check (char_length(content) > 0 and char_length(content) <= 20000);

-- Índice pensado para la carga del historial: "todos los mensajes de ESTA transcripción, en orden
-- cronológico" (ver `page.tsx`) — el filtro por dueño lo resuelve RLS, no hace falta en el índice.
create index if not exists chat_messages_transcription_created_idx
  on public.chat_messages (transcription_id, created_at asc);

-- ---------- Row Level Security (cada usuario ve/inserta SOLO sus propios mensajes) ----------
-- Append-only, igual que `ai_usage_log`: la app nunca actualiza ni borra un mensaje individual (no
-- hay edición de mensajes en el MVP) — sin policy de UPDATE/DELETE a propósito, mismo criterio que
-- evitó el CRÍTICO #1 de `ai_usage_log` (un DELETE propio no debe poder alterar el historial que
-- después se le vuelve a mandar al LLM como contexto de la conversación).
alter table public.chat_messages enable row level security;

drop policy if exists "own chat messages" on public.chat_messages;
drop policy if exists "own chat messages select" on public.chat_messages;
drop policy if exists "own chat messages insert" on public.chat_messages;

create policy "own chat messages select" on public.chat_messages
  for select using (auth.uid() = user_id);

create policy "own chat messages insert" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- Nota de ownership: el `transcription_id` de un insert NO se valida acá contra su dueño real (la FK
-- solo exige que la fila exista) — la barrera real es el endpoint, que primero lee la transcripción
-- vía el cliente RLS-scoped de `getApiUser` (`.from("transcriptions")...`, mismo patrón que
-- `/api/summarize`) y devuelve 404 si no es del usuario, ANTES de insertar cualquier mensaje. Un
-- intento de insertar un mensaje "propio" (`user_id = auth.uid()`) apuntando al `transcription_id`
-- de otra persona no filtra nada (SELECT sigue scopeado a `auth.uid() = user_id`, jamás ve mensajes
-- ajenos) — mismo nivel de riesgo aceptado que el resto de las FKs de la app.

-- ---------- Cap de uso diario del chat (reusa ai_usage_log, kind = 'chat') ----------
-- Segundo trigger BEFORE INSERT sobre `ai_usage_log`, independiente de
-- `enforce_ai_usage_summary_limit` (`20260710130000_ai_usage_log.sql`) — Postgres soporta múltiples
-- triggers BEFORE INSERT sobre la misma tabla, cada uno se queda con su propio `kind` y ignora el
-- resto, así que no hace falta tocar la función/migración de resumen para agregar este cap. El
-- número (60) DEBE coincidir con `CHAT_DAILY_LIMIT` en `src/lib/aiUsage.ts`. Mismo criterio de
-- "cota de costo, no candado duro bajo READ COMMITTED" documentado en el trigger de resumen.
create or replace function public.enforce_ai_usage_chat_limit()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
  window_start timestamptz := now() - interval '24 hours';
begin
  if new.kind <> 'chat' then
    return new;
  end if;

  select count(*) into daily_count
  from public.ai_usage_log
  where user_id = new.user_id
    and kind = 'chat'
    and created_at >= window_start;

  if daily_count >= 60 then
    raise exception 'ai_chat_daily_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ai_usage_chat_limit on public.ai_usage_log;
create trigger trg_enforce_ai_usage_chat_limit
  before insert on public.ai_usage_log
  for each row execute function public.enforce_ai_usage_chat_limit();
