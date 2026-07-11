import { parseModelTitleTagsResponse, type TitleTagsResult } from "./format";

const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Mismo modelo barato que el resto de los post-procesos de texto (resumen/traducción/vocabulario,
// ver ROADMAP.md) — un chat completion de un título + unos tags cuesta una fracción de centavo.
const TITLE_TAGS_MODEL = "llama-3.1-8b-instant";

/**
 * Tope de caracteres del texto que se manda a generar título+tags. Mismo valor y mismo criterio que
 * `MAX_SUMMARY_INPUT_CHARS` (`src/lib/summary/groq.ts`): NO existe para "entrar en la ventana de
 * contexto" (un título/tags nunca necesitaría tanto texto) — existe como defensa dura de costo/abuso,
 * consistente con el resto de los caps de input de esta app.
 */
export const MAX_TITLE_TAGS_INPUT_CHARS = 40_000;

// Techo de tokens de salida. Mucho más bajo que el del resumen (2048): la salida acá es un título
// corto (5-8 palabras) + hasta 5 tags cortos — un JSON de unas pocas líneas, nunca necesita más que
// esto aunque el modelo agregue algo de formato de más. Cota de costo/abuso, mismo criterio que
// `MAX_SUMMARY_OUTPUT_TOKENS`.
const MAX_TITLE_TAGS_OUTPUT_TOKENS = 300;

/**
 * Timeout de ESTA llamada puntual. A diferencia del resto de los módulos `groq.ts` de la app (que
 * confían en el `maxDuration` del route como único techo), este paso corre INLINE dentro de
 * `/api/transcribe` DESPUÉS de transcribir + traducir + corregir vocabulario — ya son varios pasos
 * secuenciales sobre el mismo request (`maxDuration = 60`). Un timeout corto y propio acá asegura
 * que, si Groq se cuelga respondiendo, este paso puntual NO se coma el resto del presupuesto de
 * tiempo del request — se corta solo y la transcripción se guarda igual (regla de oro de este paso,
 * ver el try/catch en el route). 8s es generoso para una respuesta de unas pocas líneas de un modelo
 * rápido (`llama-3.1-8b-instant`) y a la vez chico frente al resto del presupuesto de 60s.
 */
export const TITLE_TAGS_TIMEOUT_MS = 8_000;

export type GenerateTitleTagsResult = { ok: true; result: TitleTagsResult } | { ok: false; error: string };

/**
 * Arma el body del chat completion que genera título+tags de `text`. Función PURA (sin red),
 * separada de `generateTitleAndTags` a propósito — mismo criterio que `buildSummaryRequest`: se
 * puede testear el prompt exacto sin mockear `fetch`.
 *
 * `languageLabel` sigue el mismo criterio que `buildSummaryRequest`: idioma conocido (traducción, o
 * idioma explícito de la transcripción) → se fuerza; `null` (idioma "auto", detectado por Whisper) →
 * se le pide al modelo responder en el MISMO idioma que el texto, para no forzar un mismatch.
 *
 * Prompt estricto contra alucinación (mismo criterio que resumen/chat): el título/tags deben
 * describir lo que el texto REALMENTE dice, sin inventar contexto que no está.
 */
export function buildTitleTagsRequest(text: string, languageLabel: string | null) {
  const languageRule = languageLabel
    ? `El "title" y los "tags" tienen que estar en ${languageLabel}, sin importar en qué idioma esté el texto original.`
    : 'Escribí el "title" y los "tags" en el MISMO idioma que el texto original; no lo traduzcas a otro idioma.';

  return {
    model: TITLE_TAGS_MODEL,
    temperature: 0.3,
    max_tokens: MAX_TITLE_TAGS_OUTPUT_TOKENS,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system",
        content:
          "Sos un asistente que le pone título y etiquetas de tema a transcripciones de audio, para " +
          "que sean fáciles de reconocer en una lista de notas. Tu única salida es un objeto JSON " +
          'válido, SIN texto antes ni después, con esta forma exacta: {"title": string, "tags": ' +
          'string[]}. Reglas estrictas: "title" es un título corto y claro de 5 a 8 palabras que ' +
          'describa de qué trata el texto (nunca genérico como "Nota de audio" o "Transcripción" — ' +
          'tiene que distinguir ESTA nota de otras). "tags" son entre 3 y 5 etiquetas de TEMA (frases ' +
          "cortas, en minúscula, sin numerar ni empezar con #), como las usarías para clasificar o " +
          "buscar la nota después. NUNCA inventes información, nombres, temas o datos que no estén " +
          "en el texto — basate solo en lo que el texto realmente dice. " +
          languageRule,
      },
      { role: "user", content: text },
    ],
  };
}

/**
 * Genera título+tags de `text` vía Groq (chat completions, `llama-3.1-8b-instant`, salida JSON).
 * Best-effort por diseño, mismo contrato que `summarizeText`/`translateText`/
 * `correctTextWithVocabulary`: cualquier falla (red, timeout, HTTP, truncado, JSON inválido/con
 * forma inesperada) devuelve `{ ok: false }` con un mensaje — NUNCA lanza. El caller
 * (`/api/transcribe`) trata cualquier `ok: false` (o incluso una excepción, por defensa en
 * profundidad) como "no se pudo esta vez": la transcripción se guarda igual, sin título/tags.
 *
 * `fetchImpl` inyectable para tests, mismo patrón que el resto de los módulos `groq.ts` de la app.
 */
export async function generateTitleAndTags(
  text: string,
  languageLabel: string | null,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<GenerateTitleTagsResult> {
  // Recorte duro del input (ver `MAX_TITLE_TAGS_INPUT_CHARS`): acá, no en la UI, para que valga para
  // cualquier caller. Una transcripción normal nunca llega a este piso; solo corta casos anómalos.
  const boundedText = text.slice(0, MAX_TITLE_TAGS_INPUT_CHARS);

  let resp: Response;
  try {
    resp = await fetchImpl(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTitleTagsRequest(boundedText, languageLabel)),
      signal: AbortSignal.timeout(TITLE_TAGS_TIMEOUT_MS),
    });
  } catch {
    // Cubre red caída Y el propio timeout de arriba (`AbortSignal.timeout` rechaza el fetch con un
    // `TimeoutError`, que cae en este mismo catch) — mismo mensaje genérico best-effort que el resto
    // de los módulos `groq.ts`, el detalle exacto no le sirve al usuario final.
    return { ok: false, error: "No se pudo contactar al generador de título y tags." };
  }

  const raw = await resp.text();
  let data: {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El generador de título y tags devolvió ${resp.status}.` };
  }

  // Truncado por `max_tokens` (guard de `finish_reason`, mismo criterio que `translateText` —
  // CRÍTICO #2 del review adversarial 2026-07-10): un JSON cortado a la mitad ya falla el parseo de
  // abajo en la práctica, pero se chequea explícito para dar un error más claro y no depender de que
  // el truncado SIEMPRE caiga justo antes de cerrar el JSON.
  if (data.choices?.[0]?.finish_reason === "length") {
    return { ok: false, error: "La respuesta quedó incompleta (truncada por el límite de tokens)." };
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { ok: false, error: "El generador de título y tags no devolvió contenido." };
  }

  const result = parseModelTitleTagsResponse(content);
  if (!result) {
    return { ok: false, error: "El generador de título y tags devolvió una respuesta con formato inesperado." };
  }

  return { ok: true, result };
}
