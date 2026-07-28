-- ============================================================
--  Team Sharing — Slice 1b, Phase 8: `ai_usage_log.project_id` (design.md ADR-11, solo
--  observabilidad)
--
--  "Medir antes de legislar": SIN cap agregado por proyecto compartido en Fase 1 — el cap sigue
--  siendo por ejecutor (ver `20260710130000_ai_usage_log.sql`, sin cambios). Esta columna solo
--  permite ver el consumo real por proyecto compartido si en el futuro aparece abuso. Sin
--  trigger, sin enforcement — a propósito.
-- ============================================================

alter table public.ai_usage_log
  add column if not exists project_id uuid null references public.projects(id) on delete set null;
