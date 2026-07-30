import { parseModelSummaryResponse } from "./format";
import type { SummarizeResult } from "./groq";

/**
 * Summarising with Gemini, for texts that do not fit in Groq's free-tier window.
 *
 * Deliberately NOT a replacement for Groq: it is only the long-text engine (see `./engine.ts`).
 * Short notes stay on `llama-3.1-8b-instant`, which is fast, cheap and already cached. And it never
 * touches transcription — Gemini bills audio at 32 tokens per second (an hour of recording is
 * ~115.000 tokens), while Groq Whisper costs $0.04 an hour and returns the timestamped segments the
 * desktop needs for diarisation.
 *
 * Same best-effort contract as `summarizeText`: any failure (network, HTTP, malformed JSON, a
 * blocked answer) returns `{ ok: false }` with a message and NEVER throws.
 */

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Overridable through `GEMINI_SUMMARY_MODEL` so the model can be changed without a deploy — Google
 * rotates these faster than we ship, and a hardcoded id that gets retired would take the whole
 * long-text path down with it.
 */
export const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || "gemini-2.5-flash";

/** Same fixed ceiling as the Groq path: a summary is short by design, it does not scale with the input. */
const MAX_SUMMARY_OUTPUT_TOKENS = 2_048;

/**
 * Builds the `generateContent` body. Pure (no network), testable without mocking `fetch` — same
 * criterion as `buildSummaryRequest` in `./groq.ts`.
 *
 * The rules go in `systemInstruction` and only the transcription goes in the user turn: keeping the
 * user's text away from the instructions is what stops a note that happens to contain "ignorá las
 * instrucciones anteriores" from steering the model.
 */
export function buildGeminiSummaryRequest(text: string, languageLabel: string | null) {
  const languageRule = languageLabel
    ? `Todo el contenido de "summary", "keyPoints" y "actionItems" tiene que estar en ${languageLabel}, sin importar en qué idioma esté el texto original.`
    : 'Escribí "summary", "keyPoints" y "actionItems" en el MISMO idioma que el texto original; no lo traduzcas a otro idioma.';

  return {
    systemInstruction: {
      parts: [
        {
          text:
            "Sos un asistente que resume transcripciones de audio para producers de contenido. " +
            "Tu única salida es un objeto JSON válido, SIN texto antes ni después, con esta forma exacta: " +
            '{"summary": string, "keyPoints": string[], "actionItems": string[]}. ' +
            'Reglas estrictas: "summary" es un párrafo breve (2 a 4 oraciones) con la idea central del texto. ' +
            '"keyPoints" son los puntos o temas más importantes discutidos, como bullets cortos, sin repetir ' +
            'el resumen. "actionItems" son tareas o próximos pasos MENCIONADOS EXPLÍCITAMENTE en el texto — ' +
            "si no hay ninguno, devolvé un array vacío []. NUNCA inventes información, nombres, cifras o " +
            "tareas que no estén en el texto — si algo no está claro, omitilo en vez de suponerlo. " +
            "El texto puede ser largo (una reunión de varias horas): cubrí TODO el contenido, no solo el " +
            "principio. " +
            languageRule,
        },
      ],
    },
    contents: [{ role: "user" as const, parts: [{ text }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
      responseMimeType: "application/json" as const,
    },
  };
}

/**
 * `fetchImpl` is injectable to test without real network, same pattern as `summarizeText`.
 */
export async function summarizeTextWithGemini(
  text: string,
  languageLabel: string | null,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<SummarizeResult> {
  let resp: Response;
  try {
    resp = await fetchImpl(`${GEMINI_ENDPOINT_BASE}/${GEMINI_SUMMARY_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        // Header, never a query parameter: a key on the URL leaks into logs, proxies and history.
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGeminiSummaryRequest(text, languageLabel)),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al servicio de resumen." };
  }

  const raw = await resp.text();
  let data: {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    error?: { message?: string };
  } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error?.message || `El servicio de resumen devolvió ${resp.status}.` };
  }

  const candidate = data.candidates?.[0];
  const content = candidate?.content?.parts?.[0]?.text?.trim();
  if (!content) {
    // Sin partes: respuesta vacía o bloqueada por un filtro (`finishReason: "SAFETY"`). Se reporta
    // como falla — nunca como un resumen vacío, que se vería como si la nota no tuviera nada.
    const reason = candidate?.finishReason;
    return {
      ok: false,
      error: reason && reason !== "STOP"
        ? `El servicio de resumen no pudo procesar el texto (${reason}).`
        : "El servicio de resumen no devolvió contenido.",
    };
  }

  const summary = parseModelSummaryResponse(content);
  if (!summary) {
    return { ok: false, error: "El servicio de resumen devolvió una respuesta con formato inesperado." };
  }

  return { ok: true, summary };
}
