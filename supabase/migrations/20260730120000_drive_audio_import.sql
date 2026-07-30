-- Importar AUDIOS al conectar una carpeta de Drive.
--
-- Hasta ahora conectar una carpeta solo traía subcarpetas y archivos .md: una carpeta llena de
-- grabaciones importaba CERO ("14 archivo(s) que no son carpeta ni .md se ignoraron"). Ahora cada
-- audio entra como una transcripción PENDIENTE que apunta al archivo en Drive, para transcribirla
-- después (ver /api/drive/transcribe).
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO `drive_file_map`:
-- `drive_file_map` es lo que consume el motor de sync (`reconcileDriveSync`). Una fila ahí con
-- kind='transcription' habilita la acción `push_update`, que escribe el Markdown de la nota ENCIMA
-- del archivo de Drive. Si el archivo mapeado fuera el .m4a, el primer sync le sobrescribiría el
-- audio original al usuario con texto — pérdida de datos irreversible del lado de Drive.
-- Referenciando el audio desde una columna propia, el motor de sync ni se entera de que existe: el
-- .m4a nunca aparece en `drive_file_map`, así que ninguna acción de sync puede tocarlo. Y como la
-- transcripción queda SIN mapeo, el sync la trata como nota nueva y hace `push_create` de un .md
-- aparte cuando tenga texto — que es exactamente el comportamiento deseado: el audio y su
-- transcripción conviviendo en la misma carpeta.
alter table public.transcriptions
  add column if not exists drive_audio_file_id text;

comment on column public.transcriptions.drive_audio_file_id is
  'Id del archivo de audio en Google Drive del que sale esta transcripción. NUNCA se registra en drive_file_map: ese mapa habilita push_update, que sobrescribiría el audio con Markdown.';

-- Búsqueda de "¿este audio de Drive ya está importado?" al reconectar una carpeta (idempotencia),
-- siempre scopeada por usuario. Parcial: la enorme mayoría de las transcripciones no vienen de un
-- audio de Drive y no tiene sentido indexarlas.
create index if not exists transcriptions_drive_audio_file_id_idx
  on public.transcriptions (user_id, drive_audio_file_id)
  where drive_audio_file_id is not null;
