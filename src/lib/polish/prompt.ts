// Mismo modelo barato de Groq que corrección/traducción/resumen (misma clase de tarea — salida
// corta/estructurada, ver tabla "Modelos de IA" en CLAUDE.md §3) — detalle de implementación, sin
// allowlist configurable, mismo criterio que `CORRECTION_MODEL` en `src/lib/vocabulary/groq.ts` y
// `TRANSLATION_MODEL` en `src/lib/translate/groq.ts`.
const POLISH_MODEL = "llama-3.1-8b-instant";

// Techo duro de tokens de salida — cota de seguridad ante costo/abuso (llama-3.1-8b-instant admite
// ~8k de salida), mismo valor y mismo criterio que `MAX_CORRECTION_OUTPUT_TOKENS`
// (`src/lib/vocabulary/groq.ts`) / `MAX_TRANSLATION_OUTPUT_TOKENS` (`src/lib/translate/groq.ts`).
// Cada llamada acá procesa UN pedazo de a lo sumo `POLISH_CHUNK_CHARS` (6.000 caracteres, ver
// `src/lib/polish/chunk.ts`) — muy por debajo del punto en el que el cálculo proporcional de abajo
// satura este techo — así que en el uso real (siempre a través de `splitForPolish`) nunca recorta un
// pulido legítimo; el techo solo protege ante un uso directo de esta función con un texto mucho más
// grande que un pedazo real.
const MAX_POLISH_OUTPUT_TOKENS = 8_000;

/**
 * Arma el body del chat completion que pule UN pedazo de texto en una sola pasada: agrega
 * puntuación y cortes de párrafo, y corrige términos/nombres mal transcriptos usando `terms` como
 * referencia autoritativa. Función PURA (sin red) — mismo criterio que `buildCorrectionRequest`
 * (`src/lib/vocabulary/groq.ts`) / `buildTranslationRequest` (`src/lib/translate/groq.ts`): separada
 * de la llamada de red para poder testear el prompt exacto sin mockear `fetch`.
 *
 * A diferencia de `buildCorrectionRequest` (que SOLO puede tocar los términos de la lista, nada
 * más), acá el modelo SÍ tiene permiso para agregar puntuación y separar en párrafos — es
 * justamente lo que este endpoint existe para arreglar en una transcripción que salió de un Whisper
 * local sin ningún post-proceso (ver `src/lib/polish/chunk.ts`). Lo que sigue igual de estricto:
 * inventar, resumir, omitir, traducir u opinar quedan prohibidos — el contenido tiene que ser el
 * mismo, solo mejor escrito.
 *
 * `terms` es OPCIONAL: si viene vacío, el prompt igual pide puntuación/párrafos, simplemente sin la
 * lista de referencia de nombres/jerga (no hace falta vocabulario cargado para que valga la pena
 * pulir un texto).
 */
export function buildPolishCall(text: string, terms: string[]) {
  // `max_tokens` proporcional al input: el output es prácticamente una COPIA del texto (con
  // puntuación/párrafos agregados y, como mucho, algún término reemplazado), así que su largo en
  // tokens ronda el del input. Mismo cálculo que `buildCorrectionRequest`/`buildTranslationRequest`:
  // divisor conservador (2 chars/token, sobreestima los tokens necesarios) más un margen fijo, para
  // que un pulido legítimo nunca se recorte.
  const maxTokens = Math.min(MAX_POLISH_OUTPUT_TOKENS, Math.ceil(text.length / 2) + 256);

  const termsBlock =
    terms.length > 0
      ? "\n\nLista de referencia autoritativa de nombres/términos correctos (corregí cualquier forma " +
        "mal transcripta que se parezca FONÉTICAMENTE a alguno de estos):\n" +
        terms.map((term) => `- ${term}`).join("\n")
      : "";

  return {
    model: POLISH_MODEL,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content:
          "Sos un editor de transcripciones de audio. El texto del usuario salió de un " +
          "reconocimiento de voz automático, así que llegó sin puntuación confiable y sin cortes de " +
          "párrafo. Tu ÚNICA tarea es reescribirlo UNA sola vez: agregá puntuación y separá el texto " +
          "en párrafos donde corresponda, y corregí términos, nombres propios o jerga que hayan " +
          "quedado mal transcriptos por errores fonéticos." +
          termsBlock +
          "\n\nReglas estrictas: NO inventes contenido que no esté en el texto original. NO resumas " +
          "ni acortes nada — el resultado tiene que conservar TODO el contenido. NO omitas ninguna " +
          "parte, por repetitiva, desordenada o irrelevante que parezca. NO traduzcas a otro idioma: " +
          "mantené el idioma original. NO opines ni agregues comentarios propios. El resultado debe " +
          "tener el MISMO contenido que el original, palabra por palabra salvo las correcciones " +
          "puntuales de términos — solo mejor puntuado y separado en párrafos. Respondé SOLO con el " +
          'texto final, sin comentarios, sin explicaciones, sin comillas ni prefijos como "Texto ' +
          'pulido:".',
      },
      { role: "user", content: text },
    ],
  };
}
