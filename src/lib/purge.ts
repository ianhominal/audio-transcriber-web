/** Fecha de corte ISO: `days` días antes de `now` (por defecto, ahora). Filas con `deleted_at` más viejo que esto son purgables. */
export function cutoffDateIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
