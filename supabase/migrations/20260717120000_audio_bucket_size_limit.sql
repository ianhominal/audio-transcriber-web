-- ============================================================
--  Bucket "audios": tope de tamaño a 50 MB (Fase: subida directa a Storage).
--
--  Por qué: Vercel tiene un tope DURO de ~4,5 MB en el body de una función serverless. El
--  desktop ahora sube audios grandes (reuniones largas, hasta ~50 MB) comprimidos a opus DIRECTO
--  a Supabase Storage con un signed upload URL (ver /api/audio/prepare), salteando por completo
--  el body de Vercel — /api/transcribe transcribe desde Storage en vez de recibir el archivo en
--  el body (ver storagePath en supabase/migrations/../src/app/api/transcribe/route.ts).
--
--  El bucket se creó sin `file_size_limit` (default de Supabase: sin límite propio, acotado solo
--  por el plan) en `20260706170000_storage_audios.sql`. Ahora se fija un tope explícito de 50 MB
--  (52428800 bytes) como cinturón de seguridad — Groq igual rechaza >25 MB (chequeo en
--  /api/transcribe), así que 50 MB deja margen holgado para audios comprimidos sin abrir la
--  puerta a subidas arbitrariamente grandes a la carpeta del usuario.
--
--  `allowed_mime_types` nunca se seteó (columna en `null` = sin restricción de tipo) — se deja
--  tal cual: no hace falta agregar audio/ogg ni audio/opus a una allowlist que no existe.
-- ============================================================

update storage.buckets
set file_size_limit = 52428800 -- 50 MB
where id = 'audios';
