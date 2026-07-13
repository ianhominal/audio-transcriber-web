/**
 * Utilidades PURAS para el "resurfacing" de notas viejas en el dashboard (quick win del
 * brainstorm, ver ROADMAP.md/BRAINSTORM.md — "Mantener vivo el archivo"). Objetivo: dar una razón
 * sutil para volver a una nota vieja en vez de dejar que el archivo se vuelva un cementerio.
 *
 * OJO — limitación conocida (documentada a propósito): esta app no trackea "última vez que se
 * abrió" una transcripción (no hay columna `last_opened_at`), así que "no abierta hace rato" se
 * aproxima con `created_at` (la más VIEJA entre las elegibles) en vez de un dato real de
 * visualización. Es la opción de menor esfuerzo que sigue siendo razonable: una nota vieja que
 * nunca se reabrió es, en la práctica, la más probable candidata a "olvidada". Si a futuro se
 * agrega tracking de apertura, `pickResurfaceCandidate` es el único lugar a tocar.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Antigüedad mínima (en días) para que una nota sea candidata a resurfacing — "hace 2-3 semanas"
 * del pedido original, elegido en el piso de ese rango para no tardar de más en resurfacear algo. */
export const RESURFACE_MIN_AGE_DAYS = 14;

export type ResurfaceCandidate = {
  id: string;
  created_at: string;
};

/** true si `createdAtIso` es lo bastante vieja como para ser candidata a resurfacing. `now`
 * inyectable (ms epoch) para tests determinísticos — default `Date.now()` en runtime real. */
export function isResurfaceEligible(createdAtIso: string, now: number = Date.now()): boolean {
  const created = new Date(createdAtIso).getTime();
  if (Number.isNaN(created)) return false;
  return now - created >= RESURFACE_MIN_AGE_DAYS * DAY_MS;
}

/**
 * Elige, de forma pura y determinística, qué nota "resurfacear" entre una lista de candidatas ya
 * scopeadas al usuario por RLS (el caller — server component — ya filtró por dueño y por
 * antigüedad mínima antes de llegar acá). Devuelve la más VIEJA que no esté en `excludeIds` —
 * notas que la usuaria ya descartó, guardadas en `localStorage` del lado del cliente (el server no
 * tiene esa info, por eso la selección final vive en el cliente, ver `ResurfaceCard`). `null` si no
 * queda ninguna candidata (ya sea porque la lista vino vacía o porque se descartaron todas).
 */
export function pickResurfaceCandidate<T extends ResurfaceCandidate>(
  candidates: T[],
  excludeIds: ReadonlySet<string> | readonly string[] = []
): T | null {
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
  const eligible = candidates.filter((c) => !exclude.has(c.id));
  if (eligible.length === 0) return null;
  return eligible.reduce((oldest, c) =>
    new Date(c.created_at).getTime() < new Date(oldest.created_at).getTime() ? c : oldest
  );
}

/**
 * Texto de tiempo relativo en español rioplatense neutro ("hoy", "hace 1 día", "hace 3 semanas"…)
 * para el copy de la card de resurfacing. `now` inyectable (ms epoch) para tests determinísticos.
 * Nunca lanza: un ISO inválido devuelve "" (el caller no debería llegar a mostrar la card en ese
 * caso, pero no vale la pena que esta función pura decida eso).
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return "";
  // Clamp a 0: reloj de servidor/cliente desincronizado no debería mostrar un tiempo negativo.
  const diffMs = Math.max(0, now - created);
  const days = Math.floor(diffMs / DAY_MS);

  if (days < 1) return "hoy";
  if (days === 1) return "hace 1 día";
  if (days < 7) return `hace ${days} días`;

  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "hace 1 semana" : `hace ${weeks} semanas`;

  const months = Math.floor(days / 30);
  if (days < 365) return months === 1 ? "hace 1 mes" : `hace ${months} meses`;

  const years = Math.floor(days / 365);
  return years === 1 ? "hace 1 año" : `hace ${years} años`;
}
