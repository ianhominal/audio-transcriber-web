-- ============================================================
--  project_color: color de acento por proyecto (Fase F2, estilo VS Code "Peacock" —
--  le da "sentido de lugar" a cada proyecto en el sidebar/header).
--
--  Paleta curada de 12 colores + `null` (neutro/sin color) — fuente de verdad de los ids
--  válidos: src/lib/project-colors.ts (PROJECT_COLOR_IDS). Se guarda el id semántico (ej.
--  "indigo"), NUNCA un hex — la resolución a clases Tailwind (y su equivalente hex para un
--  futuro cliente desktop) vive en ese mismo módulo.
--
--  Nota de RLS: `projects` ya tiene la policy "own projects" (20260706154044_init_schema.sql)
--  definida como `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` — RLS
--  actúa a nivel de FILA, no de columna, así que esta columna nueva queda cubierta
--  automáticamente sin necesidad de una policy adicional (verificado leyendo esa migración antes
--  de asumirlo, no se inventa la cobertura).
--
--  OJO: esta migración vive en la branch — no se aplica sola todavía; se aplica automática recién
--  al pushear/mergear a `main` (integración Supabase↔GitHub), mismo criterio ya usado por
--  `20260709090000_user_settings.sql` (F1) y `20260707130000_drive_sync_v2_foundation.sql`. Hasta
--  entonces la app degrada sin romper nada (ver el fallback ante `42703` en
--  `src/app/app/page.tsx` y `src/app/app/actions.ts`): columna ausente = proyecto sin color.
-- ============================================================

alter table public.projects
  add column if not exists color text;

-- Allowlist a nivel DB — mismo criterio que `user_settings_engine_check`/`user_settings_quality_check`
-- (20260709090000_user_settings.sql) y `drive_connections_status_check`
-- (20260707140000_drive_connection_status.sql): defensa ante un write fuera de la app (dashboard,
-- script con service role) que la validación de src/lib/project-colors.ts no puede cubrir.
-- `null` es un valor válido (proyecto sin color / neutro, el default implícito de la columna).
alter table public.projects
  drop constraint if exists projects_color_check;
alter table public.projects
  add constraint projects_color_check
    check (
      color is null or color in (
        'red', 'orange', 'amber', 'green', 'teal', 'cyan',
        'blue', 'indigo', 'violet', 'purple', 'pink', 'rose'
      )
    );
