/**
 * Corta un texto largo en pedazos que entren en una llamada al LLM, SIN PERDER NADA.
 *
 * Existe por un caso real: el corrector de vocabulario (`MAX_CORRECTION_INPUT_CHARS = 12.000`)
 * se diseñó para notas de voz cortas y RECHAZA cualquier texto más largo. La transcripción de una
 * reunión de una a tres horas ronda los 60.000-180.000 caracteres — entre 5x y 15x el tope — así
 * que hoy no se puede corregir justo lo que más lo necesita.
 *
 * La invariante que sostiene todo esto: `splitForPolish(t).join("") === t`, SIEMPRE, para
 * cualquier entrada. Los pedazos se llevan sus separadores, así que concatenarlos reconstruye el
 * original carácter por carácter. Es lo que garantiza que partir el texto nunca le coma una
 * palabra a nadie — perder parte de una reunión que alguien grabó una sola vez sería mucho peor
 * que no corregirla.
 */

/**
 * Tope por pedazo. Bien por debajo de `MAX_CORRECTION_INPUT_CHARS` (12.000): el LLM devuelve una
 * COPIA corregida, así que la salida pesa como la entrada y necesita margen en `max_tokens`.
 */
export const POLISH_CHUNK_CHARS = 6_000;

/**
 * Tope total del texto a pulir. Cota de costo/abuso: cada pedazo es una llamada al LLM, así que
 * sin esto un texto gigante dispara N llamadas. 200k caracteres ≈ una reunión de ~3 horas.
 */
export const MAX_POLISH_INPUT_CHARS = 200_000;

/** Cortes preferidos, del más deseable al menos: párrafo, oración, cualquier espacio. */
const PARAGRAPH_BREAK = /\n\s*\n/g;
const SENTENCE_END = /[.!?…](?=\s)/g;
const WHITESPACE = /\s/g;

/**
 * Busca el mejor punto de corte dentro de `[min, max)` del texto. Devuelve el índice DESPUÉS del
 * cual cortar, o `-1` si no hay ninguno bueno (entonces el llamador corta duro).
 */
function findBreak(text: string, min: number, max: number): number {
  const window = text.slice(0, max);

  for (const pattern of [PARAGRAPH_BREAK, SENTENCE_END, WHITESPACE]) {
    let best = -1;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(window)) !== null) {
      const end = match.index + match[0].length;
      if (end > min && end <= max) best = end;
      if (match[0].length === 0) pattern.lastIndex++; // guarda anti-loop
    }
    if (best > 0) return best;
  }
  return -1;
}

/**
 * Parte el texto en pedazos de a lo sumo `chunkChars`, cortando en el límite más natural
 * disponible (párrafo > oración > espacio > corte duro).
 *
 * Garantía: concatenar el resultado devuelve EXACTAMENTE el texto original.
 */
export function splitForPolish(text: string, chunkChars: number = POLISH_CHUNK_CHARS): string[] {
  if (chunkChars <= 0) throw new Error("chunkChars debe ser mayor a 0.");
  if (text.length === 0) return [];
  if (text.length <= chunkChars) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > chunkChars) {
    // El mínimo evita pedazos ridículamente chicos cuando el único corte posible está al principio.
    const min = Math.floor(chunkChars / 2);
    const cut = findBreak(rest, min, chunkChars);
    const at = cut > 0 ? cut : chunkChars; // sin corte natural: corte duro, pero nunca se pierde texto
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at);
  }

  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * Une los pedazos ya pulidos. Cada pedazo vuelve del LLM con su propia puntuación y párrafos, así
 * que se separan con una línea en blanco y se limpian los espacios de los bordes para no arrastrar
 * saltos dobles del corte original.
 */
export function joinPolished(chunks: string[]): string {
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join("\n\n");
}
