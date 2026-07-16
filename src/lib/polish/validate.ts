/**
 * Decide si lo que devolvió el modelo se puede usar, o si hay que quedarse con el original.
 *
 * Nace de un caso real y grave (2026-07-15): el pulido convirtió la frase "Y el Madrid tiene a los
 * jugadores del mundo en plantilla, a Vinicius Junior" en tres frases que INVENTABAN una plantilla
 * (Benzema, Modrić, Kroos) que ni siquiera existe hoy — el modelo la sacó de su entrenamiento, no
 * del audio. Un turno de dos segundos ("Qué duro, loco.") se convirtió en un monólogo entero. Y en
 * un bloque vacío el modelo respondió "Por favor, proporciona el texto del usuario", que terminó
 * pegado adentro de la transcripción.
 *
 * Un transcriptor que le pone palabras en la boca a la gente es peor que uno que no corrige nada:
 * una alucinación que se nota molesta, una que suena bien se te cuela en el trabajo. Ante la duda,
 * SIEMPRE gana el texto original.
 *
 * El corrector de vocabulario (`src/lib/vocabulary/groq.ts`) ya tenía esta defensa desde siempre;
 * el pulido nació sin ella. Esto la empareja, con los umbrales adaptados a que pulir SÍ agrega
 * caracteres a propósito (puntuación, tildes, mayúsculas).
 */

/**
 * El pulido agrega puntuación y tildes, así que crecer un poco es esperable y correcto. Más de un
 * 40% es otra cosa: es el modelo escribiendo de más. (El corrector de vocabulario usa 1.5, pero ese
 * solo cambia palabras sueltas; acá el margen es más chico porque el riesgo demostrado es inventar.)
 */
export const MAX_POLISH_OUTPUT_RATIO = 1.4;

/** Si volvió mucho más corto, se comió texto. También se descarta. */
export const MIN_POLISH_OUTPUT_RATIO = 0.6;

/**
 * Por debajo de esto ni se le manda al modelo. Un turno de tres palabras ("Qué duro, loco.") no
 * necesita puntuación, y mandarlo solo lo invita a llenar el vacío inventando — que es exactamente
 * lo que pasó. Pulir bloque por bloque (para proteger las etiquetas de hablante) hace que estos
 * fragmentos mínimos sean comunes, no una rareza.
 */
export const MIN_POLISH_CHARS = 40;

/**
 * Frases con las que el modelo habla CON el usuario en vez de devolver el texto pulido. Si aparece
 * alguna, no es una transcripción: es el asistente rompiendo el personaje.
 */
const META_RESPONSE_MARKERS = [
  "no hay texto proporcionado",
  "proporciona el texto",
  "proporcione el texto",
  "por favor, proporciona",
  "no se proporcionó",
  "no proporcionaste",
  "como modelo de lenguaje",
  "aquí está el texto",
  "aquí tienes el texto",
];

export type PolishVerdict =
  | { use: "polished" }
  | { use: "original"; reason: "too-long" | "too-short" | "meta-response" | "empty" };

/** true si el texto es tan corto que no vale la pena (ni es seguro) pulirlo. */
export function isTooShortToPolish(text: string): boolean {
  return text.trim().length < MIN_POLISH_CHARS;
}

/** true si la respuesta parece el modelo hablándole al usuario en vez de devolver el texto. */
export function looksLikeMetaResponse(text: string): boolean {
  const lower = text.toLowerCase();
  return META_RESPONSE_MARKERS.some((m) => lower.includes(m));
}

/**
 * Veredicto sobre la salida del modelo. Ante cualquier señal rara devuelve `original`: perder una
 * corrección cosmética no le arruina el día a nadie; que la app invente una cita, sí.
 */
export function judgePolished(original: string, polished: string): PolishVerdict {
  const cleaned = polished.trim();
  if (!cleaned) return { use: "original", reason: "empty" };
  if (looksLikeMetaResponse(cleaned)) return { use: "original", reason: "meta-response" };

  const base = original.trim().length;
  if (cleaned.length > base * MAX_POLISH_OUTPUT_RATIO) return { use: "original", reason: "too-long" };
  if (cleaned.length < base * MIN_POLISH_OUTPUT_RATIO) return { use: "original", reason: "too-short" };

  return { use: "polished" };
}
