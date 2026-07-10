/** Fecha de corte ISO: `days` días antes de `now` (por defecto, ahora). Filas con `deleted_at` más viejo que esto son purgables. */
export function cutoffDateIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Fila vencida mínima que el cron de purga necesita para decidir qué limpiar. */
export type ExpiredTranscription = { id: string; audio_url: string | null };

/** Paths de audio (no-null) a intentar borrar de Storage para un lote de filas vencidas. */
export function audioPathsToRemove(expired: ExpiredTranscription[]): string[] {
  return expired.map((t) => t.audio_url).filter((path): path is string => Boolean(path));
}

/**
 * Decide qué filas vencidas se pueden borrar en duro sin dejar audio HUÉRFANO en Storage — lógica
 * pura extraída del cron (`src/app/api/cron/purge/route.ts`) para poder testearla aislada (bugfix
 * LOW #10 + su corrección en el re-juicio, review adversarial 2026-07-10).
 *
 * `audioRemovalSucceeded` = el `.remove(paths)` de Storage NO devolvió error de lote (o no había
 * ningún audio que borrar). Storage borra en UN request todos los paths pedidos y NO da error por
 * un objeto ya inexistente (simplemente no lo lista en `data`) — por eso la decisión es a nivel de
 * LOTE, no por-path:
 *   - éxito → TODAS las filas vencidas son purgables: las que tenían audio ya se borró (o ya no
 *     estaba, que es lo mismo a efectos de no dejar huérfanos) y las que no tenían audio no dejan
 *     nada atrás. Esto corrige la regresión que marcó el re-juicio: comparar contra el `data`
 *     devuelto dejaba las filas cuyo audio YA estaba borrado reintentándose para siempre (nunca
 *     aparecen en `data`).
 *   - fallo → solo se purgan las filas SIN audio; las que tienen audio quedan soft-deleted para que
 *     el próximo cron reintente (corrige el bug original: borrar la fila con un Storage caído
 *     orfanaba el audio, porque ya no quedaba la referencia para reintentar).
 */
export function selectPurgeableTranscriptionIds(
  expired: ExpiredTranscription[],
  audioRemovalSucceeded: boolean
): string[] {
  if (audioRemovalSucceeded) return expired.map((t) => t.id);
  return expired.filter((t) => !t.audio_url).map((t) => t.id);
}
