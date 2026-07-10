const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Modelo barato de Groq (no el de transcripción) — un chat completion corto de traducción cuesta
// centavos de centavo (~$0.001 por transcripción típica, ver ROADMAP.md item 6/F4). Fijo, sin
// allowlist configurable: es un detalle de implementación de la traducción, no una opción de
// producto (a diferencia de `ALLOWED_GROQ_MODELS` en `@/lib/transcribe/model.ts`, que sí lo es).
const TRANSLATION_MODEL = "llama-3.1-8b-instant";

/**
 * Tope de caracteres del texto que se manda a traducir. A diferencia del resumen (que puede
 * truncar el INPUT sin problema, ver `MAX_SUMMARY_INPUT_CHARS` en `src/lib/summary/groq.ts`), acá
 * NO se puede truncar: la traducción REEMPLAZA el texto final de la transcripción (`finalText` en
 * `/api/transcribe`), así que truncar el input perdería la cola del texto en el resultado guardado.
 * Por eso, ante un texto más largo que el cap, `translateText` directamente NO traduce (ver abajo,
 * mismo criterio que `correctTextWithVocabulary` con `MAX_CORRECTION_INPUT_CHARS`) — el caller
 * (`/api/transcribe`) ya sabe tratar un `ok:false` como best-effort: conserva la transcripción
 * original y avisa con `translationWarning`, sin perder nunca el trabajo de Whisper.
 */
export const MAX_TRANSLATION_INPUT_CHARS = 40_000;

// Techo duro de tokens de salida — cota de seguridad ante costo/abuso (llama-3.1-8b-instant admite
// ~8k de salida), mismo valor y mismo criterio que `MAX_CORRECTION_OUTPUT_TOKENS` en
// `src/lib/vocabulary/groq.ts`: con `MAX_TRANSLATION_INPUT_CHARS` el `max_tokens` calculado siempre
// queda por debajo de este techo, así que jamás recorta una traducción legítima.
const MAX_TRANSLATION_OUTPUT_TOKENS = 8_000;

export type TranslateResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Arma el body del chat completion que traduce `text` al idioma `targetLabel`. Función PURA (sin
 * red) separada de `translateText` a propósito: se puede testear el prompt exacto sin mockear
 * `fetch`, mismo criterio que separa `resolveGroqModel` (validación) de su uso en `/api/transcribe`.
 *
 * El prompt es intencionalmente estricto: el modelo NO debe "conversar" ni agregar comentarios,
 * preguntas, comillas o prefijos — solo la traducción. El texto suele venir de una transcripción
 * de audio (sin puntuación prolija), así que se pide preservar la estructura (párrafos/saltos de
 * línea) tal cual viene, no "mejorarla".
 *
 * `max_tokens` proporcional al input (la traducción es una reescritura COMPLETA del texto, no un
 * resumen — su largo en tokens es ~el del input): mismo cálculo que `buildCorrectionRequest`
 * (`src/lib/vocabulary/groq.ts`), con el mismo divisor conservador (2 chars/token) más margen fijo,
 * para que una traducción legítima nunca se trunque.
 */
export function buildTranslationRequest(text: string, targetLabel: string) {
  const maxTokens = Math.min(MAX_TRANSLATION_OUTPUT_TOKENS, Math.ceil(text.length / 2) + 256);
  return {
    model: TRANSLATION_MODEL,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content:
          `Sos un traductor profesional. Traducí el texto del usuario al idioma "${targetLabel}". ` +
          "Reglas estrictas: respondé SOLO con la traducción, sin comentarios, sin explicaciones, " +
          'sin agregar comillas ni prefijos como "Traducción:". Conservá el sentido, el tono y la ' +
          "estructura del texto original (párrafos y saltos de línea tal cual). Si el texto ya está " +
          "en ese idioma, devolvelo sin cambios.",
      },
      { role: "user", content: text },
    ],
  };
}

/**
 * Traduce `text` al idioma `targetLabel` vía Groq (chat completions, `llama-3.1-8b-instant`).
 * Best-effort por diseño: cualquier falla (red, HTTP, respuesta vacía/no-JSON) devuelve
 * `{ ok: false }` con un mensaje — NUNCA lanza. El caller (`/api/transcribe`) decide qué hacer;
 * el criterio ahí es no perder nunca la transcripción original si la traducción falla.
 *
 * `fetchImpl` es inyectable para poder testear sin red real pasando un mock por parámetro. (Nota:
 * `src/lib/drive/api.ts` también envuelve `fetch` pero sus tests usan la estrategia opuesta —
 * `vi.stubGlobal("fetch", ...)` sobre el global — así que esto NO copia ese patrón; es inyección
 * explícita por argumento, elegida acá por ser más directa de razonar en una función pura.)
 */
export async function translateText(
  text: string,
  targetLabel: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<TranslateResult> {
  if (!text.trim()) return { ok: true, text: "" };

  // Textos larguísimos no se traducen (best-effort, ver comentario de `MAX_TRANSLATION_INPUT_CHARS`
  // más arriba): preferible devolver `ok:false` (el caller conserva el original con warning) a
  // arriesgarse a perder la cola del texto por truncarlo, o a mandar un input que dispare un 400 de
  // Groq por exceso de tokens.
  if (text.length > MAX_TRANSLATION_INPUT_CHARS) {
    return { ok: false, error: "El texto es demasiado largo para traducir automáticamente." };
  }

  let resp: Response;
  try {
    resp = await fetchImpl(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTranslationRequest(text, targetLabel)),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al traductor." };
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
    return { ok: false, error: data?.error?.message || `El traductor devolvió ${resp.status}.` };
  }

  // Truncado por `max_tokens` (corrección del review adversarial 2026-07-10, CRÍTICO #2): el
  // `max_tokens` de `buildTranslationRequest` satura en su techo (8k) para inputs grandes (~15k+
  // chars), bien por debajo del cap de `MAX_TRANSLATION_INPUT_CHARS` (40k) que SÍ se acepta. Si Groq
  // corta la salida a la mitad devuelve `finish_reason: "length"` con el texto PARCIAL — devolverlo
  // como `{ ok: true }` haría que `/api/transcribe` guarde la traducción truncada como texto final,
  // perdiendo la cola en silencio (justo lo que el cap del input quería evitar). Tratado como fallo:
  // el caller preserva el original con `translationWarning`, mismo criterio best-effort del resto.
  if (data.choices?.[0]?.finish_reason === "length") {
    return { ok: false, error: "La traducción quedó incompleta (el texto es demasiado largo)." };
  }

  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) {
    return { ok: false, error: "El traductor no devolvió texto." };
  }
  return { ok: true, text: translated };
}
