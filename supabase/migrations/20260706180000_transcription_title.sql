-- ============================================================
--  Transcripciones — título propio editable (Fase 2)
--  Independiente del nombre del archivo (audio_name).
-- ============================================================
alter table public.transcriptions
  add column if not exists title text not null default '';
