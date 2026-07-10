const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Mismo modelo barato de Groq que traducción/resumen (~$0.001 por corrección, ver
// .claude/resources/BUSINESS.md) — detalle de implementación, sin allowlist configurable, mismo
// criterio que `TRANSLATION_MODEL` en `src/lib/translate/groq.ts`.
const CORRECTION_MODEL = "llama-3.1-8b-instant";

// Cap de longitud de input al LLM. A diferencia del resumen (que puede truncar sin problema: el
// resultado es un derivado, no reemplaza el texto), acá NO se puede truncar y pegar el resto sin
// re-correr el modelo: se arriesgaría a devolver menos texto del que el usuario ya tiene guardado.
// Por eso, ante un texto más largo que el cap, `correctTextWithVocabulary` directamente NO corrige
// (ver abajo) en vez de truncar. Es más bajo que `MAX_SUMMARY_INPUT_CHARS` (40k) a propósito: acá el
// modelo debe DEVOLVER el texto entero corregido (no un resumen corto), así que el largo del input
// también acota el `max_tokens` de salida — este valor mantiene el `max_tokens` calculado por debajo
// del límite del modelo, para que una corrección legítima nunca se trunque (ver `buildCorrectionRequest`).
export const MAX_CORRECTION_INPUT_CHARS = 12_000;

// Techo duro de tokens de salida — cota de seguridad (llama-3.1-8b-instant admite ~8k de salida).
// Con `MAX_CORRECTION_INPUT_CHARS` el `max_tokens` calculado siempre queda por debajo de este techo,
// así que jamás recorta una corrección válida; el techo solo existe como red ante un cálculo futuro.
const MAX_CORRECTION_OUTPUT_TOKENS = 8_000;

// Cota superior del largo del texto corregido respecto del original. Una corrección solo reemplaza
// nombres/jerga mal transcriptos por su forma correcta (largo parecido) — nunca debería alargar el
// texto significativamente. Un output más largo que esto es señal de que el modelo "se fue de tema"
// (ignoró el prompt estricto, posible efecto de un término malicioso en la lista): se descarta y se
// deja el texto original. `0.5` como piso protege el invariante paramount "nunca perder texto": un
// output demasiado corto (modelo que truncó o recortó contenido) también se descarta.
const MAX_OUTPUT_RATIO = 1.5;
const MIN_OUTPUT_RATIO = 0.5;

export type CorrectionResult =
  | { ok: true; text: string; corrected: boolean }
  | { ok: false; error: string };

/**
 * Arma el body del chat completion que corrige `text` reemplazando, SOLO donde aparezcan mal
 * transcriptos fonéticamente, los términos de `terms` por su forma exacta. Función PURA (sin red),
 * separada de `correctTextWithVocabulary` a propósito — mismo criterio que
 * `buildTranslationRequest`/`buildSummaryRequest`: se puede testear el prompt exacto sin mockear
 * `fetch`.
 *
 * El prompt es intencionalmente MUY estricto: el modelo no debe reescribir, mejorar ni inventar
 * nada — solo sustituir coincidencias fonéticas de la lista. El reemplazo por string no sirve acá
 * (el error real es fonético, ej. "balen tino" en vez de "Valentino"), por eso se delega al LLM en
 * vez de un `.replace()` — pero el prompt lo acota al máximo para que se comporte como un find-and-
 * replace inteligente, no como un editor de estilo.
 */
export function buildCorrectionRequest(text: string, terms: string[]) {
  const list = terms.map((term) => `- ${term}`).join("\n");
  // `max_tokens` proporcional al input: el output es una COPIA corregida del texto, así que su largo
  // en tokens es ~el del input. Se estima con un divisor conservador (2 chars/token — sobreestima los
  // tokens necesarios) más un margen fijo, para que una corrección legítima nunca se recorte. El
  // techo duro es una cota final de costo/abuso. Como el input está capado en `MAX_CORRECTION_INPUT_CHARS`,
  // el valor calculado siempre cae por debajo del techo — el techo nunca trunca en la práctica.
  const maxTokens = Math.min(MAX_CORRECTION_OUTPUT_TOKENS, Math.ceil(text.length / 2) + 256);
  return {
    model: CORRECTION_MODEL,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content:
          "Sos un corrector de transcripciones de audio. Tu ÚNICA tarea es revisar el texto del " +
          "usuario y corregir las palabras de la siguiente lista que hayan quedado mal transcriptas " +
          'por errores FONÉTICOS de reconocimiento de voz (por ejemplo "balen tino" en vez de ' +
          '"Valentino"), reemplazándolas por su forma EXACTA de la lista:\n' +
          list +
          "\n\n" +
          "Reglas estrictas: NO cambies ninguna otra palabra, ni la puntuación, ni las mayúsculas de " +
          "palabras que no estén en la lista, ni la estructura de oraciones — no reescribas ni " +
          "mejores el texto de ninguna otra forma. NO inventes ni agregues nada que no esté en el " +
          "texto original. Si ningún término de la lista aparece mal transcripto, devolvé el texto " +
          "EXACTAMENTE igual, sin ningún cambio. Respondé SOLO con el texto corregido, sin " +
          'comentarios, sin explicaciones, sin comillas ni prefijos como "Texto corregido:".',
      },
      { role: "user", content: text },
    ],
  };
}

/**
 * Corrige `text` con el vocabulario custom del usuario (`terms`) vía Groq (chat completions,
 * `llama-3.1-8b-instant`). Best-effort por diseño: cualquier falla (red, HTTP, respuesta vacía/no-
 * JSON) devuelve `{ ok: false }` con un mensaje — NUNCA lanza. El caller (`/api/transcribe`) decide
 * qué hacer; el criterio ahí es el mismo que la traducción (F4): si falla, el texto queda como
 * estaba, nunca se pierde ni se bloquea el request.
 *
 * Ahorro explícito: si `terms` está vacío o `text` está vacío, NO llama al LLM — devuelve el texto
 * tal cual (`corrected: false`). Mismo criterio de "no llamar si no hace falta" que `translateText`
 * (texto vacío) y `canSummarizeText` (texto muy corto).
 *
 * `corrected: true` solo si el texto devuelto por el modelo es distinto al original — así el caller
 * puede mostrar el aviso "corregido con tu vocabulario" únicamente cuando de verdad cambió algo.
 *
 * `fetchImpl` inyectable para tests, mismo patrón que `translateText`/`summarizeText`.
 */
export async function correctTextWithVocabulary(
  text: string,
  terms: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<CorrectionResult> {
  if (!text.trim() || terms.length === 0) return { ok: true, text, corrected: false };

  // Textos larguísimos no se corrigen (best-effort, ver comentario de `MAX_CORRECTION_INPUT_CHARS`):
  // preferible no corregir a arriesgarse a perder la cola del texto por truncarlo.
  if (text.length > MAX_CORRECTION_INPUT_CHARS) return { ok: true, text, corrected: false };

  let resp: Response;
  try {
    resp = await fetchImpl(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildCorrectionRequest(text, terms)),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al corrector." };
  }

  const raw = await resp.text();
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El corrector devolvió ${resp.status}.` };
  }

  const corrected = data.choices?.[0]?.message?.content?.trim();
  if (!corrected) {
    return { ok: false, error: "El corrector no devolvió texto." };
  }

  // Descarte defensivo: una corrección válida tiene un largo parecido al original (solo cambia
  // nombres/jerga por su forma correcta). Si el output es desproporcionado —mucho más largo (el
  // modelo "se fue de tema", posible efecto de un término malicioso en la lista) o mucho más corto
  // (truncó/recortó contenido)— NO se usa: se deja el texto original tal cual. Best-effort, mismo
  // criterio que "ante la duda, no perder el texto del usuario". Se compara contra `text.trim()`
  // porque el modelo devuelve el contenido ya sin espacios de borde (`corrected` viene trim-eado).
  const baseline = text.trim();
  if (corrected.length > baseline.length * MAX_OUTPUT_RATIO || corrected.length < baseline.length * MIN_OUTPUT_RATIO) {
    return { ok: true, text, corrected: false };
  }

  return { ok: true, text: corrected, corrected: corrected !== text };
}
