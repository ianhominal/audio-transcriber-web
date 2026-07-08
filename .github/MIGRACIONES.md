# Migraciones automáticas de Supabase

Cada push a `main` que toque `supabase/migrations/**` dispara el workflow
`.github/workflows/supabase-migrations.yml`, que aplica las migraciones pendientes
a la base de producción. También se puede correr a mano desde **Actions → Migraciones
Supabase → Run workflow**.

## Setup (una sola vez)

### 1. Cargar el secret con la connection string

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- **Name**: `SUPABASE_DB_URL`
- **Value**: la connection string de tu base. En Supabase: **Project Settings →
  Database → Connection string**. Usá la de **"Session pooler"** (es IPv4 y soporta
  DDL), y reemplazá `[YOUR-PASSWORD]` por la contraseña real de la base.

  Se ve así:
  ```
  postgresql://postgres.vxlbvvtgdkxaktdiepow:TU_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
  ```

> ⚠️ Es la contraseña de la BASE (Database password), no la API key. Si no la
> recordás, la podés resetear en Project Settings → Database.

### 2. Sincronización única (marcar las migraciones ya aplicadas)

Las 6 primeras migraciones se aplicaron a mano, así que Supabase no tiene registro
de ellas. Sin este paso, el primer `db push` intentaría re-aplicarlas y chocaría.

Corré este SQL **una sola vez** en **Supabase → SQL Editor**:

```sql
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

-- Marca como YA APLICADAS las migraciones previas a esta sesión (las que hacen
-- andar el sync hoy). Las 2 nuevas (jerarquía + status Drive) quedan pendientes
-- a propósito, para que el workflow las aplique.
insert into supabase_migrations.schema_migrations (version) values
  ('20260706154044'),
  ('20260706170000'),
  ('20260706180000'),
  ('20260706190000'),
  ('20260706200000'),
  ('20260707120000')
on conflict (version) do nothing;
```

### 3. Aplicar las 2 migraciones pendientes

Andá a **Actions → Migraciones Supabase → Run workflow** (botón "Run workflow" sobre
`main`). Eso aplica las 2 pendientes:
- `20260707130000_drive_sync_v2_foundation.sql` (jerarquía / subcarpetas)
- `20260707140000_drive_connection_status.sql` (estado de conexión Drive)

Si el run sale verde, ya está: de acá en más, cada migración nueva se aplica sola al
pushear. Si falla, revisá el log del step "Aplicar migraciones pendientes" (lo más
común es que la connection string esté mal o falte el paso 2).
