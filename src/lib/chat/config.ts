/**
 * Chat con IA sobre una transcripción puntual (MVP por-transcripción, ver ROADMAP.md). Este módulo
 * es PURO (sin red ni Supabase) — arma el system prompt y valida el mensaje del usuario, testeable
 * sin mockear nada, mismo criterio que `buildSummaryRequest` en `src/lib/summary/groq.ts`.
 *
 * A diferencia de resumen/traducción/vocabulario (que llaman a Groq por `fetch` crudo), el chat usa
 * el Vercel AI SDK (`streamText` + `@ai-sdk/groq`) directamente en `src/app/api/chat/route.ts` — así
 * que acá NO hay un `buildXRequest`/`xText()` que arme el body del chat completion; solo la config y
 * el texto del system prompt que ese route le pasa a `streamText`.
 */

/**
 * Modelo de chat de Groq. A diferencia de resumen/traducción/vocabulario (`llama-3.1-8b-instant`,
 * elegido por ser barato para una tarea corta y acotada), el chat es conversación abierta con la
 * usuaria — acá SÍ vale pagar el modelo de mejor calidad conversacional disponible en Groq:
 * `llama-3.3-70b-versatile` (131k de contexto, ~280 tok/s, confirmado en
 * console.groq.com/docs/models al momento de implementar esta feature). Sigue siendo Groq (rápido,
 * mismo proveedor que el resto de la app) y sigue siendo barato en términos absolutos frente a un
 * modelo de frontera — solo más caro que 8b-instant, lo cual se justifica acá porque la calidad de
 * la respuesta ES el producto (a diferencia del resumen, que es una tarea estructurada corta).
 */
export const CHAT_MODEL = "llama-3.3-70b-versatile";

/**
 * Techo de tokens de salida por respuesta — misma razón de costo/abuso que `MAX_SUMMARY_OUTPUT_TOKENS`
 * (auditoría 2026-07-10, MEDIUM #3): sin este límite, un desvío del modelo podría generar una
 * respuesta arbitrariamente larga y cara. Más alto que el del resumen (2048) porque acá el pedido
 * puede ser "armá una lista de tareas" o "escribí un mensaje con esto" — salidas más largas que un
 * resumen estructurado, pero igual acotadas: una respuesta de chat legítima nunca necesita más.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 2_048;

/**
 * Tope de caracteres del texto de la transcripción que se manda como contexto en el system prompt.
 * Mismo criterio y mismo valor que `MAX_SUMMARY_INPUT_CHARS`/`MAX_TRANSLATION_INPUT_CHARS`: no existe
 * para "entrar en la ventana de contexto" (una transcripción normal nunca se acerca a este piso),
 * existe como defensa dura de costo/abuso — se recorta acá, server-side, nunca confiando en el
 * cliente.
 */
export const MAX_CHAT_CONTEXT_INPUT_CHARS = 40_000;

/**
 * Tope de caracteres de UN mensaje del usuario. Mucho más bajo que el contexto de la transcripción a
 * propósito: una pregunta o pedido legítimo en un chat es corto (una oración o dos); no hay motivo
 * para aceptar un mensaje de usuario de decenas de miles de caracteres — es o un error del cliente o
 * un intento de abuso (inflar el costo del request o inyectar contenido enorme en el prompt).
 */
export const MAX_CHAT_MESSAGE_CHARS = 4_000;

/**
 * true si `text` es un mensaje de usuario válido para mandar al chat: no vacío (después de trim) y
 * dentro de `MAX_CHAT_MESSAGE_CHARS`. Pura, sin acceso a red/DB — se llama desde el route ANTES de
 * llamar a Groq (la validación del cliente nunca es la frontera de confianza, mismo criterio que el
 * resto de los caps de esta app).
 */
export function isValidChatMessageText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CHAT_MESSAGE_CHARS;
}

/**
 * Arma el system prompt del chat: instruye al modelo a responder SOLO en base al texto de la
 * transcripción (sin inventar), listar lo que puede hacer (resumir, extraer ideas, armar listas de
 * tareas, redactar contenido, responder preguntas puntuales) y responder siempre en español, en
 * lenguaje simple — quien usa esta app no es técnica (ver `.claude/resources/BUSINESS.md`, tono del
 * producto). Recorta `transcriptionText` a `MAX_CHAT_CONTEXT_INPUT_CHARS` ANTES de armar el prompt —
 * mismo criterio de cap server-side que `buildSummaryRequest`.
 *
 * Grounding estricto: mismo criterio anti-alucinación que `buildSummaryRequest`/
 * `buildCorrectionRequest` — la regla explícita de "si no está en el texto, decilo" existe porque sin
 * ella el modelo tiende a completar con conocimiento general en vez de admitir que el texto no cubre
 * lo preguntado, lo cual sería activamente engañoso para una usuaria que confía en que la respuesta
 * viene DE su transcripción.
 */
export function buildChatSystemPrompt(transcriptionText: string): string {
  const boundedText = transcriptionText.slice(0, MAX_CHAT_CONTEXT_INPUT_CHARS);

  return (
    "Sos un asistente que ayuda a analizar UNA transcripción de audio puntual. Tu única fuente de " +
    "información sobre el contenido es el texto que te paso más abajo — no inventes datos, nombres, " +
    "cifras ni hechos que no estén en el texto. Si te preguntan algo que el texto no responde, decilo " +
    "con honestidad en vez de inventar o suponer.\n\n" +
    "Podés ayudar a: resumir el contenido, extraer ideas o puntos clave, armar listas de tareas, " +
    "redactar mensajes o textos a partir de lo dicho, y responder preguntas puntuales sobre la " +
    "transcripción.\n\n" +
    "Respondé siempre en español, de forma clara y directa, sin tecnicismos innecesarios — quien te " +
    "lee no es técnica. Mantené las respuestas breves y al grano, salvo que te pidan explícitamente " +
    "algo largo (por ejemplo, un texto completo para redactar).\n\n" +
    "Texto de la transcripción:\n" +
    '"""\n' +
    boundedText +
    '\n"""'
  );
}
