-- ============================================================
--  Team Sharing — Slice 1a: auditoría de colisiones de `HashId` (design.md §7).
--
--  ESTO NO ES UNA MIGRACIÓN. No vive en `supabase/migrations/` a propósito: es un script de
--  auditoría de UNA vez, que corre el dueño A MANO en el SQL Editor de Supabase, contra producción,
--  como prerequisito duro antes de publicar el release del desktop de este slice (tasks.md Phase 12.1).
--  No lo ejecuta ningún agente ni ningún pipeline automático.
--
--  Reproduce en Postgres el `HashId` de .NET (`LocalScanner.cs:161-168`), incluido el layout
--  MIXED-ENDIAN de `Guid(byte[])`: los primeros 4 bytes se leen como int32 little-endian, los 2
--  siguientes como int16 LE, los 2 siguientes como int16 LE, y los últimos 8 tal cual — por eso los
--  nibbles de versión/variante quedan mal ubicados (gotcha #15 de CLAUDE.md, y ADR-12 del design:
--  el regex de forma en /api/brain se queda por esta misma razón).
--
--  `pgcrypto` vive en el schema `extensions` en Supabase (no en `public`).
-- ============================================================

create or replace function public.desktop_hash_id(p_path_key text)
returns uuid language sql immutable as $$
  with raw as (
    select substring(extensions.digest(p_path_key, 'sha256') from 1 for 16) as b
  ),
  tagged as (
    select set_byte(set_byte(b, 6, (get_byte(b, 6) & 15) | 64),
                            8, (get_byte(b, 8) & 63) | 128) as g
    from raw
  )
  select (
      encode(substring(g from 4 for 1) || substring(g from 3 for 1) ||
             substring(g from 2 for 1) || substring(g from 1 for 1), 'hex') || '-' ||
      encode(substring(g from 6 for 1) || substring(g from 5 for 1), 'hex') || '-' ||
      encode(substring(g from 8 for 1) || substring(g from 7 for 1), 'hex') || '-' ||
      encode(substring(g from 9  for 2), 'hex') || '-' ||
      encode(substring(g from 11 for 6), 'hex')
  )::uuid
  from tagged;
$$;

-- (A) Población en riesgo: filas cuyo id ES el hash determinístico de su propio nombre.
select 'project' as kind, p.id, p.user_id, p.name
from public.projects p
where p.deleted_at is null
  and p.id = public.desktop_hash_id('project:' || p.name)
union all
select 'transcription', t.id, t.user_id, t.audio_name
from public.transcriptions t
left join public.projects pr on pr.id = t.project_id
where t.deleted_at is null
  and t.id = public.desktop_hash_id('transcription:' || coalesce(pr.name, '') || '/' || t.audio_name);

-- (B) Superficie de colisión: nombres de proyecto reclamados por MÁS DE UNA cuenta.
-- Limitación honesta: el pathKey usa el nombre de CARPETA (Workspace.Sanitize(Title)), y `Sanitize`
-- no es reproducible en SQL. Esta query matchea exacto cuando el nombre no necesita saneado (el caso
-- común) y SUB-REPORTA con nombres que llevan caracteres inválidos de Windows. Es un tamiz, no una
-- prueba — documentar así el resultado.
with named as (
  select p.id, p.user_id, p.name,
         public.desktop_hash_id('project:' || p.name) as det_id
  from public.projects p
  where p.deleted_at is null
)
select n.name,
       count(distinct n.user_id)             as accounts,
       bool_or(n.id = n.det_id)              as deterministic_id_taken,
       array_agg(n.user_id::text || ' -> ' || n.id::text) as detail
from named n
group by n.name
having count(distinct n.user_id) > 1
order by accounts desc, n.name;
