import { parseModelSummaryResponse, type SummaryResult } from "./format";
import { GROQ_SAFE_SUMMARY_CHARS } from "./engine";

const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Mismo modelo barato que la traducción (Fase F4) — un chat completion corto de resumen cuesta
// centavos de centavo (~$0.001, ver ROADMAP.md item 6/F5). No hay motivo para pagar un modelo más
// caro para esta tarea.
const SUMMARY_MODEL = "llama-3.1-8b-instant";

/**
 * Tope de caracteres que se le mandan a Groq para resumir.
 *
 * CORREGIDO (2026-07-30): antes eran 40.000 caracteres, con el razonamiento de que la ventana de
 * contexto del modelo era amplia y esto era solo una cota de costo. Ese razonamiento ignoraba el
 * límite que de verdad manda en el free tier: **6.000 tokens por MINUTO**. 40.000 caracteres pedían
 * ~12.234 tokens, así que TODA nota larga fallaba con "Request too large" — y no es un rate limit
 * transitorio, un request más grande que el tope se rechaza siempre. Ahora vale
 * `GROQ_SAFE_SUMMARY_CHARS`, calculado a partir de ese tope (ver `./engine.ts`).
 *
 * Los textos que no entran acá NO se recortan: van a Gemini, que tiene lugar de sobra
 * (`planSummary`). Este slice queda como defensa dura para cualquier caller que llame a
 * `summarizeText` directo — la validación de quien llama nunca es la frontera de confianza, mismo
 * criterio que las allowlists de `resolveGroqModel`/idiomas.
 */
export const MAX_SUMMARY_INPUT_CHARS = GROQ_SAFE_SUMMARY_CHARS;

// Techo de tokens de salida — cota de costo/abuso (auditoría 2026-07-10, hallazgo MEDIUM #3: el
// endpoint no tenía `max_tokens`, así que un desvío del modelo podía generar una respuesta
// arbitrariamente larga y cara). A diferencia de la traducción/corrección (donde el output es ~del
// largo del input, ver `src/lib/translate/groq.ts`/`src/lib/vocabulary/groq.ts`), un resumen es
// SIEMPRE corto por diseño — no escala con `MAX_SUMMARY_INPUT_CHARS` — así que acá el tope es un
// valor FIJO, no proporcional. 2048 tokens da margen de sobra para el peor caso legítimo (resumen +
// hasta 12 keyPoints + 12 actionItems, ver los topes de `src/lib/summary/format.ts`) sin dejar que
// el modelo se extienda indefinidamente.
const MAX_SUMMARY_OUTPUT_TOKENS = 2_048;

export type SummarizeResult = { ok: true; summary: SummaryResult } | { ok: false; error: string };

/**
 * Arma el body del chat completion que resume `text`. Función PURA (sin red), testeable sin mockear
 * `fetch` — mismo criterio que `buildTranslationRequest` en `src/lib/translate/groq.ts`.
 *
 * `languageLabel` es el idioma en el que se quiere el resumen cuando se CONOCE (traducción de F4, o
 * idioma explícito de la transcripción); `null` cuando NO se conoce (transcripción con idioma
 * "auto", detectado por Whisper) — en ese caso se le pide al modelo resumir en el MISMO idioma que
 * el texto, en vez de forzar uno y arriesgar un mismatch (ej. resumir en español un audio en
 * francés). Es el bug que corrigió el review adversarial: antes se colapsaba todo lo que no fuera
 * "en" a español.
 *
 * Se pide el JSON schema DENTRO del system prompt (no solo vía `response_format`): Groq requiere
 * que el schema esté descrito en el prompt para `json_object` mode, pasarlo solo por
 * `response_format` no alcanza (confirmado antes de implementar — ver changelog del día). Reglas
 * estrictas de fidelidad: nada de inventar información que no esté en el texto, ni "rellenar"
 * `actionItems` si no hay tareas explícitas (mejor un array vacío que alucinar una).
 */
export function buildSummaryRequest(text: string, languageLabel: string | null) {
  const languageRule = languageLabel
    ? `Todo el contenido de "summary", "keyPoints" y "actionItems" tiene que estar en ${languageLabel}, sin importar en qué idioma esté el texto original.`
    : 'Escribí "summary", "keyPoints" y "actionItems" en el MISMO idioma que el texto original; no lo traduzcas a otro idioma.';

  return {
    model: SUMMARY_MODEL,
    temperature: 0.2,
    max_tokens: MAX_SUMMARY_OUTPUT_TOKENS,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system",
        content:
          "Sos un asistente que resume transcripciones de audio para producers de contenido. " +
          "Tu única salida es un objeto JSON válido, SIN texto antes ni después, con esta forma exacta: " +
          '{"summary": string, "keyPoints": string[], "actionItems": string[]}. ' +
          'Reglas estrictas: "summary" es un párrafo breve (2 a 4 oraciones) con la idea central del texto. ' +
          '"keyPoints" son los puntos o temas más importantes discutidos, como bullets cortos, sin repetir ' +
          'el resumen. "actionItems" son tareas o próximos pasos MENCIONADOS EXPLÍCITAMENTE en el texto — ' +
          "si no hay ninguno, devolvé un array vacío []. NUNCA inventes información, nombres, cifras o " +
          "tareas que no estén en el texto — si algo no está claro, omitilo en vez de suponerlo. " +
          languageRule,
      },
      { role: "user", content: text },
    ],
  };
}

/**
 * Resume `text` vía Groq (chat completions, `llama-3.1-8b-instant`, salida JSON). Best-effort por
 * diseño: cualquier falla (red, HTTP, JSON inválido/con forma inesperada) devuelve `{ ok: false }`
 * con un mensaje — NUNCA lanza. Mismo contrato que `translateText`.
 *
 * `fetchImpl` inyectable para testear sin red real, mismo patrón que `translateText`.
 */
export async function summarizeText(
  text: string,
  languageLabel: string | null,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<SummarizeResult> {
  // Recorte duro del input (ver `MAX_SUMMARY_INPUT_CHARS`): acá, no en la UI, para que valga para
  // cualquier caller. Una transcripción normal nunca llega a este piso; solo corta casos anómalos.
  const boundedText = text.slice(0, MAX_SUMMARY_INPUT_CHARS);

  let resp: Response;
  try {
    resp = await fetchImpl(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildSummaryRequest(boundedText, languageLabel)),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al servicio de resumen." };
  }

  const raw = await resp.text();
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El servicio de resumen devolvió ${resp.status}.` };
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { ok: false, error: "El servicio de resumen no devolvió contenido." };
  }

  const summary = parseModelSummaryResponse(content);
  if (!summary) {
    return { ok: false, error: "El servicio de resumen devolvió una respuesta con formato inesperado." };
  }

  return { ok: true, summary };
}
