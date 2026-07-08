-- ============================================================
--  Drive-connection status: distingue "conectado" de "token revocado"
--  Google puede revocar el refresh_token (desde myaccount.google.com, expiración por
--  inactividad, etc.) sin que la fila de `drive_connections` desaparezca — antes de esta
--  migración, Ajustes mostraba "Google Drive conectado" solo por existir la fila, aunque el
--  token ya no sirviera. Ver `src/lib/drive/connection-status-compat.ts`.
-- ============================================================

alter table public.drive_connections
  add column if not exists status text not null default 'active';

alter table public.drive_connections
  drop constraint if exists drive_connections_status_check;
alter table public.drive_connections
  add constraint drive_connections_status_check check (status in ('active', 'revoked'));
