export const AUDIO_BUCKET = "audios";

/** Extensión de un nombre de archivo, en minúsculas y con punto ("" si no tiene). */
export function audioExtension(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename ?? "");
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * Path del objeto en Storage: {userId}/{objectId}{ext}.
 * El primer segmento es el userId para que la RLS aísle por carpeta.
 */
export function buildAudioObjectPath(userId: string, objectId: string, ext: string): string {
  return `${userId}/${objectId}${ext}`;
}
