-- ============================================================
--  Transcripciones — traducción vía LLM (Fase F4, ver .claude/resources/ROADMAP.md item 6/F4).
--
--  El modo "translate" nativo de Whisper SOLO traduce a inglés (confirmado por research antes de
--  implementar, ver ROADMAP.md "Decisiones tomadas") — inútil para traducir a español u otro
--  idioma. La forma correcta: transcribir con Whisper (Groq) y, si el usuario pidió "Transcribir y
--  traducir", traducir el TEXTO resultante con un LLM (Groq `llama-3.1-8b-instant`, ver
--  src/lib/translate/groq.ts). Con esto se puede traducir a CUALQUIER idioma de la allowlist, no
--  solo inglés.
--
--  Modelo de datos elegido (mínimo para el MVP): `text` sigue siendo el resultado FINAL (traducido
--  si se pidió traducción; igual que hoy si no) — así ningún código que ya lee `text` (dashboard,
--  export, sync a desktop) necesita cambios. Se agregan DOS columnas nullable:
--    - `translated_to`: idioma destino (código corto, ej. "en") si esta transcripción se tradujo;
--      `null` si es una transcripción normal (compat total con las filas existentes).
--    - `original_text`: el texto crudo de Whisper ANTES de traducir, solo cuando se tradujo — para
--      poder mostrar "ver original" en el detalle sin perder la fuente. `null` si no se tradujo.
--  Alternativa descartada: una tabla aparte `transcription_translations` — de más para el MVP
--  (1 traducción por transcripción, no historial), mismo criterio de simpleza que ya usó F2
--  (`projects.color` como columna, no tabla).
--
--  OJO: igual que `20260709090000_user_settings.sql` (F1) y `20260709200000_project_color.sql`
--  (F2), esta migración vive en la branch y se aplica automática recién al pushear/mergear a
--  `main` (integración Supabase↔GitHub). Hasta entonces la app funciona igual sin ella: las
--  columnas nuevas son nullable y el server las trata como ausentes/`null` si Supabase todavía no
--  las tiene (ver `resolveTranscribeMode`/manejo de errores en `/api/transcribe`).
-- ============================================================

alter table public.transcriptions
  add column if not exists translated_to text;

alter table public.transcriptions
  add column if not exists original_text text;

-- Allowlist a nivel DB — mismo criterio que `user_settings_language_check`
-- (20260709090000_user_settings.sql) y `projects_color_check` (20260709200000_project_color.sql):
-- defensa ante un write fuera de la app que la validación de `src/lib/translate/languages.ts` no
-- puede cubrir. Fuente de verdad de los códigos válidos: TRANSLATION_LANGUAGES en ese módulo.
alter table public.transcriptions
  drop constraint if exists transcriptions_translated_to_check;
alter table public.transcriptions
  add constraint transcriptions_translated_to_check
    check (translated_to is null or translated_to in ('es', 'en', 'pt', 'fr', 'it', 'de'));

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre estas columnas nuevas — actúa a nivel de fila, no de columna (mismo razonamiento ya
-- verificado y dejado por escrito en 20260709200000_project_color.sql).
