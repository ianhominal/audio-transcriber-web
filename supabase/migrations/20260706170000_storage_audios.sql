-- ============================================================
--  Storage — bucket privado para los audios (Fase 2)
--  Cada usuario sube/lee/borra SOLO su carpeta: {user_id}/...
--  La descarga se hace con signed URLs generadas en el server.
-- ============================================================

-- Bucket privado (public = false → todo pasa por RLS / signed URLs).
insert into storage.buckets (id, name, public)
values ('audios', 'audios', false)
on conflict (id) do nothing;

-- ---------- Row Level Security sobre storage.objects ----------
drop policy if exists "audios: subir a la propia carpeta" on storage.objects;
create policy "audios: subir a la propia carpeta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audios'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "audios: leer la propia carpeta" on storage.objects;
create policy "audios: leer la propia carpeta" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audios'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "audios: borrar la propia carpeta" on storage.objects;
create policy "audios: borrar la propia carpeta" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audios'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
