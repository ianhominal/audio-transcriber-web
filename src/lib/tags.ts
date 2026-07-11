/**
 * Utilidades PURAS y compartidas para tags de tema de una transcripción (tanda 3 de quick wins, ver
 * ROADMAP.md — auto-título + auto-tags al transcribir). Compartido entre la sanitización de la
 * respuesta del LLM (`src/lib/titleTags/format.ts`) y el filtro por tag del dashboard
 * (`src/app/app/page.tsx`) para que AMBOS lados usen exactamente la misma noción de "el mismo tag" —
 * sin esto, un tag guardado como "reunión" y un filtro tecleado a mano como "Reunión " (con
 * mayúscula/espacio) no matchearían.
 */

/** Cantidad máxima de tags por transcripción — pedido del producto ("3 a 5 tags"), con margen. */
export const MAX_TAGS = 5;

/** Largo máximo de un tag individual — una "frase corta de tema", no una oración. */
export const MAX_TAG_LENGTH = 40;

/**
 * Normaliza un tag crudo: trim + minúsculas (pedido del producto: "tags de tema, minúscula") + cap
 * de largo. `null` si no es un string o queda vacío después del trim — nunca lanza.
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TAG_LENGTH);
}

/**
 * Normaliza y sanea una lista cruda de tags (de la respuesta del LLM, o de cualquier otro caller):
 * normaliza cada uno (`normalizeTag`), descarta los inválidos/vacíos, deduplica (ya normalizados, así
 * que "Reunión" y "reunión" cuentan como el mismo tag) y capa a `MAX_TAGS`. Nunca lanza, nunca exige
 * un mínimo — un LLM que devuelva 1 o 2 tags en vez de 3-5 sigue siendo mejor que ninguno
 * (best-effort, ver `src/lib/titleTags/groq.ts`).
 */
export function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

/**
 * Normaliza el valor de un filtro por tag (query param `?tag=` en `src/app/app/page.tsx`, o el texto
 * de un chip clickeado) con la MISMA regla que `normalizeTag` — para que un tag guardado en
 * minúscula siga matchendo aunque el filtro llegue con otro casing/espacios (ej. alguien tipeó la
 * URL a mano). `null` si no hay filtro válido (ausente, vacío, o no-string) — el caller lo trata
 * como "sin filtro activo".
 */
export function normalizeTagFilter(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  return normalizeTag(raw);
}
