/**
 * Color por hablante para la vista "Leer" de una transcripción (ver `TranscriptReader`). Es solo
 * presentación: no toca el texto ni cómo se guarda, únicamente le da a cada voz un color estable
 * para que una reunión se pueda seguir de un vistazo (quién dice qué), que es exactamente lo que
 * hoy no se puede porque todo cae en un bloque plano.
 */

/**
 * Paleta deliberadamente corta y de tonos bien distinguibles entre sí. Cada entrada trae su par
 * claro/oscuro porque `text-*-600` sobre fondo oscuro no llega a contraste AA — mismo criterio que
 * el resto de la app (ver los `dark:` de los colores de acento). Se cicla si hay más hablantes que
 * colores (una reunión con 7 voces reusa el primer color en la séptima; es raro y aceptable).
 */
const PALETTE = [
  "text-indigo-600 dark:text-indigo-400",
  "text-teal-600 dark:text-teal-400",
  "text-rose-600 dark:text-rose-400",
  "text-amber-600 dark:text-amber-400",
  "text-sky-600 dark:text-sky-400",
  "text-violet-600 dark:text-violet-400",
];

/** Neutro para "Sin identificar": no es una voz más, es el descarte — no gasta un color. */
const NEUTRAL = "text-tertiary";

/** Etiqueta que el desktop usa para lo que no pudo atribuir a ninguna voz (ver `splitSpeakerBlocks`). */
const UNIDENTIFIED = "Sin identificar";

/**
 * Asigna un color a cada etiqueta en el ORDEN en que aparecen los hablantes. Recibe las etiquetas
 * tal como salen de `splitSpeakerBlocks` (con repeticiones, en orden del texto) y devuelve un mapa
 * etiqueta → clases Tailwind. Estable dentro de una misma transcripción: la primera voz siempre
 * lleva el primer color aunque hable muchas veces; "Sin identificar" siempre va en neutro y nunca
 * consume un color de la paleta.
 */
export function assignSpeakerColors(labels: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  let next = 0;
  for (const label of labels) {
    if (map.has(label)) continue;
    if (label === UNIDENTIFIED) {
      map.set(label, NEUTRAL);
    } else {
      map.set(label, PALETTE[next % PALETTE.length]);
      next++;
    }
  }
  return map;
}
