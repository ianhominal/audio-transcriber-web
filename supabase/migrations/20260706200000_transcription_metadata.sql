-- ============================================================
--  Transcripciones — metadata rica (descripción + ícono)
-- ============================================================
alter table public.transcriptions
  add column if not exists description text not null default '';

alter table public.transcriptions
  add column if not exists icon text not null default '';
