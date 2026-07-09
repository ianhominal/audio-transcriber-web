const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Modelo barato de Groq (no el de transcripción) — un chat completion corto de traducción cuesta
// centavos de centavo (~$0.001 por transcripción típica, ver ROADMAP.md item 6/F4). Fijo, sin
// allowlist configurable: es un detalle de implementación de la traducción, no una opción de
// producto (a diferencia de `ALLOWED_GROQ_MODELS` en `@/lib/transcribe/model.ts`, que sí lo es).
const TRANSLATION_MODEL = "llama-3.1-8b-instant";

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
 */
export function buildTranslationRequest(text: string, targetLabel: string) {
  return {
    model: TRANSLATION_MODEL,
    temperature: 0.2,
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
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El traductor devolvió ${resp.status}.` };
  }

  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) {
    return { ok: false, error: "El traductor no devolvió texto." };
  }
  return { ok: true, text: translated };
}
