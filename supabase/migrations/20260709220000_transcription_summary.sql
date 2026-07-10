-- ============================================================
--  Transcripciones — resumen con IA (Fase F5, ver .claude/resources/ROADMAP.md).
--
--  Objetivo: dado el texto de una transcripción, generar un resumen breve + puntos clave + action
--  items vía LLM (Groq `llama-3.1-8b-instant`, mismo modelo barato que la traducción de F4, ver
--  src/lib/summary/groq.ts) para que el usuario obtenga el "jugo" sin releer todo.
--
--  Modelo de datos elegido (mínimo para el MVP, mismo criterio que F4 con `translated_to`/
--  `original_text`): DOS columnas nullable en vez de una tabla aparte `transcription_summaries` —
--  1 resumen por transcripción, no historial, no amerita una tabla propia.
--    - `summary`: el resultado estructurado (`{ summary, keyPoints, actionItems }`, ver
--      src/lib/summary/format.ts) serializado como JSON en un campo `text` — así no hace falta
--      parsear/filtrar por sub-campo en SQL, siempre se lee/escribe como una unidad.
--    - `summary_source_hash`: sha256 hex del texto EXACTO que se resumió (ver
--      src/lib/summary/hash.ts). Sirve para detectar que el usuario editó el texto DESPUÉS de
--      generar el resumen (resumen desactualizado → la UI ofrece "Regenerar") sin duplicar el
--      texto completo en una segunda columna como sí hace `original_text` en F4 (ahí SÍ hace falta
--      mostrar el texto original en el detalle; acá el hash solo se compara, nunca se muestra).
--
--  `text` (la transcripción) NO cambia — el resumen es un derivado que se guarda aparte, nunca
--  reemplaza ni se mezcla con el texto principal.
--
--  OJO: igual que `20260709210000_translation.sql` (F4) y las migraciones anteriores, esta vive en
--  la branch/commit y se aplica automática recién al pushear a `main` (integración
--  Supabase↔GitHub). Hasta entonces la app funciona igual sin ella: ambas columnas son nullable y
--  el server las trata como ausentes/`null` si Supabase todavía no las tiene (fallback `42703`,
--  reusa `isMissingColumnError` de `src/lib/supabase/schema-compat.ts`).
-- ============================================================

alter table public.transcriptions
  add column if not exists summary text;

alter table public.transcriptions
  add column if not exists summary_source_hash text;

-- RLS existente en `transcriptions` (policy "own transcriptions", ver 20260706154044_init_schema.sql)
-- ya cubre estas columnas nuevas — actúa a nivel de fila, no de columna (mismo razonamiento ya
-- verificado y dejado por escrito en 20260709200000_project_color.sql / 20260709210000_translation.sql).
