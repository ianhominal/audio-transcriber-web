/**
 * Caps y validación de los "Formatos" (instrucciones IA reutilizables, ver brief "Formatos"
 * 2026-07-13). Función PURA sin dependencias server-only a propósito: se usa tanto en
 * `/api/recipes` (validar antes de escribir) como en la UI (`formatos-section.tsx`, para deshabilitar
 * el input antes de pegarle al endpoint) — mismo criterio de reuso que `sanitizeTerm`/
 * `canAddVocabularyTerm` en `src/lib/vocabulary/validate.ts`.
 */

/** Largo máximo del nombre de un formato — coincide con `ai_recipes_name_check` de la migración. */
export const MAX_NAME_LENGTH = 80;

/**
 * Largo máximo de la instrucción — más generoso que `MAX_NAME_LENGTH` a propósito: una instrucción
 * legítima puede ser un párrafo completo ("Convertí esto en un brief de producción con objetivo,
 * público, tono y entregables"), no una palabra suelta. Coincide con `ai_recipes_instruction_check`
 * de la migración.
 */
export const MAX_INSTRUCTION_LENGTH = 2_000;

/**
 * Cantidad máxima de formatos por usuario. A diferencia de `MAX_VOCABULARY_TERMS` (100, con un
 * trigger atómico en la DB), este cap vive SOLO en código de aplicación — ver el comentario de
 * cabecera en la migración `20260713120000_ai_recipes.sql` sobre por qué no hace falta un trigger acá
 * (el riesgo real de costo/abuso está en las LLAMADAS al LLM al aplicar un formato, no en la
 * cantidad de filas guardadas).
 */
export const MAX_RECIPES = 30;

/**
 * Tope de caracteres del texto de la transcripción que se manda como contexto al aplicar un formato.
 * Mismo criterio y mismo valor que `MAX_SUMMARY_INPUT_CHARS` (`src/lib/summary/groq.ts`) y
 * `MAX_CHAT_CONTEXT_INPUT_CHARS` (`src/lib/chat/config.ts`): no existe para "entrar en la ventana de
 * contexto" (una transcripción normal nunca se acerca a este piso), existe como defensa dura de
 * costo/abuso — se recorta acá, server-side, nunca confiando en el cliente. Constante propia (no
 * importada de `chat/config.ts`) siguiendo la misma convención de "cada módulo declara su propio
 * cap con el mismo valor" que ya usan resumen/chat/traducción.
 */
export const MAX_RECIPE_INPUT_CHARS = 40_000;

/**
 * Normaliza y valida el nombre de un formato (del body de un request o de un `<input>`). `null` si
 * no es un string, si queda vacío después del trim, o si supera `MAX_NAME_LENGTH` — nunca lanza. El
 * mensaje de error concreto lo arma el caller (mismo criterio que `sanitizeTerm`).
 */
export function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

/**
 * Normaliza y valida la instrucción de un formato. `null` si no es un string, si queda vacía después
 * del trim, o si supera `MAX_INSTRUCTION_LENGTH` — nunca lanza. Mismo criterio que `sanitizeName`.
 */
export function sanitizeInstruction(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INSTRUCTION_LENGTH) return null;
  return trimmed;
}

/** true si el usuario todavía puede agregar otro formato sin superar `MAX_RECIPES`. */
export function canAddRecipe(currentCount: number): boolean {
  return currentCount < MAX_RECIPES;
}

/**
 * Arma la instrucción final que se manda al modelo al aplicar un formato: la instrucción del
 * usuario (lo que quiere que se haga con la nota) enmarcada con una framing fija + el texto de la
 * transcripción (recortado a `MAX_RECIPE_INPUT_CHARS`, mismo criterio de cap server-side que
 * `buildSummaryRequest`/`buildChatSystemPrompt`). Función PURA (sin red) — se usa como `prompt` de
 * `streamText` en `/api/recipes/apply` (generación single-shot, sin historial de mensajes, así que no
 * hace falta un array de `messages`).
 *
 * La instrucción del usuario va PRIMERO (antes del texto) para que quede claro qué se le pide al
 * modelo antes de mostrarle la nota — mismo orden natural que seguiría una persona explicando la
 * tarea antes de pegar el material de referencia.
 */
export function buildRecipePrompt(instruction: string, transcriptionText: string): string {
  const boundedText = transcriptionText.slice(0, MAX_RECIPE_INPUT_CHARS);

  return (
    "Sos un asistente que transforma transcripciones de audio según una instrucción puntual de la " +
    "persona que las grabó. Aplicá la siguiente instrucción al texto de la nota que aparece más " +
    "abajo. Basate ÚNICAMENTE en lo que dice el texto — no inventes datos, nombres, cifras ni hechos " +
    "que no estén ahí. Respondé siempre en español, de forma clara y directa. Tu única salida es el " +
    "resultado pedido, sin explicaciones previas ni comentarios sobre la tarea.\n\n" +
    "Instrucción:\n" +
    '"""\n' +
    instruction +
    '\n"""\n\n' +
    "Texto de la nota:\n" +
    '"""\n' +
    boundedText +
    '\n"""'
  );
}
