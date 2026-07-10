-- ============================================================
--  Vocabulario custom — corrección de nombres/jerga vía LLM (feature diferencial #1, ver
--  .claude/resources/BUSINESS.md "Apuesta #1").
--
--  Objetivo: el usuario carga una lista de términos "correctos" (nombres de invitados recurrentes,
--  marcas, jerga técnica) y, al transcribir, un paso de post-proceso corrige con un LLM (Groq
--  `llama-3.1-8b-instant`, mismo modelo barato que traducción/resumen, ver src/lib/vocabulary/groq.ts)
--  los errores fonéticos de Whisper sobre ESOS términos puntuales — sin reescribir ni inventar nada
--  más del texto.
--
--  Modelo de datos elegido: tabla `vocabulary_terms`, UNA FILA POR TÉRMINO (no una columna JSON/array
--  en `user_settings`). A diferencia de `translated_to`/`summary` (1 valor por transcripción,
--  correctamente modelados como columna en F4/F5), acá el usuario mantiene una LISTA de longitud
--  variable que edita con frecuencia (agregar/editar/borrar términos sueltos) — una tabla por fila
--  escala mejor para ese patrón de edición: cada operación es un INSERT/UPDATE/DELETE puntual con su
--  propio id, sin tener que leer-modificar-reescribir un array/JSON completo en cada cambio (evita
--  además una carrera clásica read-then-write si el usuario edita rápido). Mismo criterio de "tabla
--  vs columna" que ya se usó al revés en F4/F5 (ahí SÍ era 1 valor → columna; acá es N valores →
--  tabla), y el mismo shape 1-fila-por-usuario-dueño que `projects`/`transcriptions` (no el shape
--  singleton de `user_settings`, que es 1 fila por usuario para varios campos).
--
--  Alcance MVP: vocabulario GLOBAL por usuario (no por proyecto) — ver BUSINESS.md.
--
--  Además se agrega UNA columna nullable a `transcriptions` (`vocabulary_corrected`) para poder
--  mostrar el aviso "corregido con tu vocabulario" en el detalle sin tener que re-derivar la
--  corrección — mismo patrón de columna nullable + fallback `42703` que `translated_to` (F4) y
--  `summary` (F5).
--
--  OJO: igual que las migraciones anteriores, esta vive en el commit y se aplica automática recién
--  al pushear a `main` (integración Supabase↔GitHub). Hasta entonces:
--    - `vocabulary_terms` como tabla nueva: si no existe todavía, cualquier lectura falla con
--      "relation does not exist" (42P01, NO 42703) — `isMissingColumnError` no la reconoce a
--      propósito (ver su comentario en schema-compat.ts), así que el store
--      (`src/lib/vocabulary/store.ts`) degrada por manejo de error genérico, no por el mecanismo de
--      compat de columnas. Mismo criterio que tuvo `user_settings` en F1: la tabla y la UI que la usa
--      se mergean juntas, sin necesitar un fallback especial pre-migración.
--    - `transcriptions.vocabulary_corrected`: nullable, se trata como ausente/`null` ante un 42703
--      (fallback ya presente en `/api/transcribe` y en el detalle, `isMissingColumnError`).
-- ============================================================

-- ---------- vocabulary_terms (N filas por usuario) ----------
create table if not exists public.vocabulary_terms (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  term       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vocabulary_terms_user_created_idx
  on public.vocabulary_terms (user_id, created_at asc);

-- Cap de largo a nivel DB — defensa ante un write fuera de la app que la validación de
-- `src/lib/vocabulary/validate.ts` (MAX_TERM_LENGTH) no puede cubrir, mismo criterio que
-- `user_settings_language_check` (F1) y `transcriptions_translated_to_check` (F4).
alter table public.vocabulary_terms
  drop constraint if exists vocabulary_terms_term_check;
alter table public.vocabulary_terms
  add constraint vocabulary_terms_term_check
    check (char_length(btrim(term)) > 0 and char_length(term) <= 80);

-- Sin duplicados por usuario (case-insensitive, ignorando espacios de borde): evita que "Valentino"
-- y "valentino " terminen como dos entradas separadas y confusas en la lista.
create unique index if not exists vocabulary_terms_user_term_unique
  on public.vocabulary_terms (user_id, lower(btrim(term)));

-- updated_at se mantiene solo en el server: reusa el trigger genérico ya establecido en
-- `20260706190000_sync_backend.sql` (mismo que usan `projects`/`transcriptions`/`user_settings`).
drop trigger if exists trg_touch_vocabulary_terms on public.vocabulary_terms;
create trigger trg_touch_vocabulary_terms
  before update on public.vocabulary_terms
  for each row execute function public.touch_updated_at();

-- Cap de cantidad de términos por usuario, ATÓMICO a nivel DB. Se hace con un trigger BEFORE INSERT
-- (no con un count-then-insert en la app) para que el límite no se pueda saltear con inserts
-- concurrentes (carrera TOCTOU): entre "contar 99" e "insertar" en la app podrían colarse varios
-- requests. Acá el conteo y la decisión ocurren dentro de la misma transacción del INSERT.
-- El número (100) debe coincidir con `MAX_VOCABULARY_TERMS` en `src/lib/vocabulary/validate.ts`.
-- Raise-ea con un token estable en el mensaje (`vocabulary_term_limit_reached`) que el store
-- (`src/lib/vocabulary/store.ts`, `isTermLimitError`) detecta para devolver un 400 amigable — nunca
-- se reenvía este mensaje crudo al cliente.
create or replace function public.enforce_vocabulary_term_limit()
returns trigger
language plpgsql
as $$
declare
  term_count integer;
begin
  select count(*) into term_count
  from public.vocabulary_terms
  where user_id = new.user_id;

  if term_count >= 100 then
    raise exception 'vocabulary_term_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_vocabulary_term_limit on public.vocabulary_terms;
create trigger trg_enforce_vocabulary_term_limit
  before insert on public.vocabulary_terms
  for each row execute function public.enforce_vocabulary_term_limit();

-- ---------- Row Level Security (cada usuario ve/edita SOLO sus propios términos) ----------
alter table public.vocabulary_terms enable row level security;

drop policy if exists "own vocabulary terms" on public.vocabulary_terms;
create policy "own vocabulary terms" on public.vocabulary_terms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- transcriptions.vocabulary_corrected ----------
alter table public.transcriptions
  add column if not exists vocabulary_corrected boolean;

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre esta columna nueva — actúa a nivel de fila, no de columna (mismo razonamiento ya
-- verificado y dejado por escrito en 20260709200000_project_color.sql / 20260709210000_translation.sql
-- / 20260709220000_transcription_summary.sql).
