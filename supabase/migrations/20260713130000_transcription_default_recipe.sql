-- ============================================================
--  Auto-aplicar el Formato default al transcribir — best-effort, mismo criterio ESTRICTO que
--  auto-título/auto-tags (20260711160000_transcription_tags.sql): si el usuario tiene un `ai_recipe`
--  marcado `is_default = true` (ver 20260713120000_ai_recipes.sql), se corre su instrucción sobre el
--  texto COMPLETO de la transcripción, EN PARALELO con la subida del audio y el paso de auto-título/
--  auto-tags (ver src/app/api/transcribe/route.ts, paso 2.7-bis / src/lib/recipes/autoApply.ts). Si
--  falla, tarda de más, o el usuario está sobre su cap diario de `kind: 'recipe'` (reusa el trigger
--  atómico `enforce_ai_usage_recipe_limit`, YA creado en 20260713120000_ai_recipes.sql — esta
--  migración NO agrega ningún trigger/cap nuevo), la transcripción se guarda IGUAL, sin el resultado
--  — nunca bloquea ni demora el guardado.
--
--  Dos columnas nuevas, NULLABLE (a diferencia de `tags`/`title`, que son NOT NULL con default: acá
--  "nunca se aplicó nada" es un estado real y distinto de "se aplicó y el resultado quedó vacío", así
--  que NULL es la representación correcta, no ''):
--   - `default_recipe_output`: el texto que devolvió el modelo al aplicar el formato.
--   - `default_recipe_name`: el NOMBRE del formato en el momento en que se aplicó — se copia (no se
--     hace join a `ai_recipes.name` en cada lectura) para que el panel de la UI pueda seguir
--     mostrando "Formato aplicado: <nombre>" aunque el formato se renombre o se borre después (mismo
--     criterio de "snapshot al momento" que ya usan `title`/`tags` respecto de su fuente).
--
--  OJO: igual que el resto de las migraciones desde F1, esta vive en el commit y se aplica automática
--  recién al pushear a `main` (integración Supabase↔GitHub). Hasta entonces: columnas NUEVAS sobre una
--  tabla EXISTENTE (`transcriptions`) — fallback `42703`, reusa `isMissingColumnError` de
--  `src/lib/supabase/schema-compat.ts`, mismo patrón de cascada que `tags`/`vocabulary_corrected`/
--  `translated_to` en `src/app/api/transcribe/route.ts` (paso 4) — se agregan como el nivel MÁS NUEVO
--  de la cascada (se piden/insertan primero, se pelan primero ante un 42703) y como el nivel MÁS
--  NUEVO del SELECT de compat del detalle (`src/app/app/t/[id]/page.tsx`).
-- ============================================================

alter table public.transcriptions
  add column if not exists default_recipe_output text,
  add column if not exists default_recipe_name text;

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre estas columnas nuevas — actúa a nivel de fila, no de columna (mismo razonamiento ya
-- verificado y dejado por escrito en las migraciones anteriores que agregan columnas a esta tabla:
-- 20260709200000_project_color.sql / 20260709210000_translation.sql /
-- 20260709220000_transcription_summary.sql / 20260711160000_transcription_tags.sql).
--
-- Cap de uso diario: NO se agrega ningún trigger nuevo acá. El auto-apply reusa `kind: 'recipe'` de
-- `ai_usage_log`, protegido por `enforce_ai_usage_recipe_limit` (creado en
-- 20260713120000_ai_recipes.sql) — mismo cap, mismo límite (50/día), que ya cubre tanto la aplicación
-- MANUAL de un formato (`/api/recipes/apply`) como este auto-apply automático al transcribir.
