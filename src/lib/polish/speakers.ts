/**
 * Separa una transcripción con hablantes ("Persona 1: …") en bloques, para poder pulir SOLO el
 * texto de cada uno y volver a pegar las etiquetas después.
 *
 * Por qué así y no mandándole el texto entero al modelo con la instrucción "conservá las
 * etiquetas": porque eso es un PEDIDO, no una garantía. Los modelos reorganizan, fusionan turnos y
 * renombran. Si la estructura tiene que sobrevivir sí o sí, no se la mandás y confiás: la sacás
 * antes, pulís solo el contenido, y la volvés a poner vos. El LLM literalmente nunca ve
 * "Persona 1:", así que no la puede romper.
 *
 * Mismo principio que `splitForPolish` (ver chunk.ts): al modelo nunca se le entrega lo que no
 * puede perder.
 */

/** Un turno: la etiqueta tal cual vino, y el texto que sí va a pasar por el modelo. */
export type SpeakerBlock = {
  /** "Persona 1", "Sin identificar" — se re-adjunta VERBATIM, nunca se regenera. */
  label: string;
  text: string;
};

/**
 * Etiquetas que produce el desktop (ver `SpeakerTranscriptFormatter` en AudioTranscriber.Core):
 * "Persona N" para cada voz detectada y "Sin identificar" para lo que no se pudo atribuir.
 * El `^` con `m` ancla al principio de línea: una frase que MENCIONE "Persona 2" en el medio no
 * abre un bloque nuevo.
 */
const BLOCK_PATTERN = /^(Persona \d+|Sin identificar):[ \t]*/;

/**
 * Parte el texto en turnos. Devuelve `null` si NO es una transcripción con hablantes — así el
 * llamador puede seguir por el camino normal sin inventar una estructura que no existe.
 */
export function splitSpeakerBlocks(text: string): SpeakerBlock[] | null {
  const chunks = text.split(/\n\s*\n/);
  const blocks: SpeakerBlock[] = [];

  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const match = chunk.match(BLOCK_PATTERN);
    // Un solo bloque sin etiqueta y ya no lo tratamos como diarizado: mezclar turnos etiquetados
    // con texto suelto haría que el texto suelto pierda su lugar al rearmar.
    if (!match) return null;

    blocks.push({
      label: match[1],
      text: chunk.slice(match[0].length).trim(),
    });
  }

  return blocks.length > 0 ? blocks : null;
}

/** Rearma los turnos con las etiquetas ORIGINALES y el texto ya pulido. */
export function joinSpeakerBlocks(blocks: SpeakerBlock[]): string {
  return blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => `${b.label}: ${b.text.trim()}`)
    .join("\n\n");
}
