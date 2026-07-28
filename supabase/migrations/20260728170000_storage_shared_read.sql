-- ============================================================
--  Team Sharing — Slice 1b, Phase 6: Storage — lookup por `audio_url` (design.md ADR-04)
--
--  Los blobs NO se mueven de `{uploaderId}/...` (`audio_url` es mutable vía drag&drop / mover de
--  proyecto; codificar el `project_id` en el path acoplaría una clave inmutable a una relación
--  mutable — anti-patrón, no atajo). Se agrega una rama de acceso compartido a la policy de
--  SELECT existente: el disyunto del dueño va PRIMERO (comparación de string, sin I/O) así el
--  ~99% del tráfico —el propio usuario— no paga el lookup nunca; el `exists` sobre
--  `transcriptions.audio_url` va después, cubierto por el índice parcial de abajo. No se filtra
--  por `deleted_at`: el dueño tiene que poder escuchar una nota en la papelera para decidir si la
--  restaura. INSERT/DELETE no se tocan — compartir un audio no es capability de Storage en este
--  slice.
-- ============================================================

create index if not exists transcriptions_audio_url_idx
  on public.transcriptions (audio_url) where audio_url is not null;

drop policy if exists "audios: leer la propia carpeta" on storage.objects;
create policy "audios: leer lo propio o lo compartido" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audios'
    and (
      (storage.foldername(name))[1] = (select auth.uid()::text)
      or exists (
        select 1 from public.transcriptions t
        where t.audio_url = storage.objects.name
          and t.project_id is not null
          and public.has_project_access(t.project_id, (select auth.uid()), 'read')
      )
    )
  );
