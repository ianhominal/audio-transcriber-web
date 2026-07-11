import type { UIMessage } from "ai";

/**
 * Fila de `chat_messages` tal como la devuelve Supabase (ver migración
 * `20260710140000_chat_messages.sql`) — el subconjunto de columnas que necesita el chat, no la fila
 * completa.
 */
export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/**
 * Forma mínima que necesita `extractUiMessageText`: no importa el `UIMessage` completo del SDK a
 * propósito (evita acoplar esta función pura a la versión exacta del tipo) — solo le hace falta
 * `parts`, con la misma forma que las partes de texto reales (`{ type: "text", text: string }`).
 */
type TextPartLike = { type: string; text?: unknown };
type UiMessageLike = { parts?: readonly TextPartLike[] };

/**
 * Extrae el texto plano de un `UIMessage` del AI SDK (formato `{ parts: [...] }`) concatenando SOLO
 * sus partes de texto (`part.type === "text"`), en orden. Se descartan otras partes (reasoning,
 * tool, file, etc.) — el chat MVP no usa tools ni adjuntos, así que en la práctica un mensaje real
 * solo trae partes de texto, pero la función es defensiva ante cualquier otra forma sin romper.
 *
 * Pura y testeable sin el SDK real — usada tanto para persistir mensajes (`src/app/api/chat/route.ts`)
 * como, potencialmente, para validar el largo del último mensaje del usuario antes de llamar a Groq.
 */
export function extractUiMessageText(message: UiMessageLike): string {
  if (!message.parts) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * Convierte filas de `chat_messages` (texto plano, orden cronológico) al formato `UIMessage[]` que
 * espera `useChat` como `messages` inicial — mismo criterio que `page.tsx` ya usa para el resumen
 * (server component arma el shape final, el cliente no reinterpreta nada). Pura: no toca Supabase.
 */
export function rowsToUIMessages(rows: readonly ChatMessageRow[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
  }));
}

/**
 * Recorta el historial que se manda como contexto a Groq (ver `MAX_CHAT_HISTORY_MESSAGES`/
 * `MAX_CHAT_HISTORY_CHARS` en `src/lib/chat/config.ts`) — corrección del review adversarial: el
 * server reconstruye el historial desde `chat_messages` (no confía en el array que mande el
 * cliente), así que este es el cap real de costo/contexto, sin importar cuántas filas existan.
 *
 * `rows` se asume YA en orden cronológico ascendente (mismo orden que devuelve la query de
 * `chat_messages`, ver `src/app/api/chat/route.ts`). Se queda con las últimas `maxMessages` filas
 * y, si su contenido combinado igual supera `maxTotalChars`, sigue descartando desde las MÁS VIEJAS
 * — nunca desde las más recientes (el mensaje más nuevo del historial es el más relevante para la
 * pregunta actual). Siempre deja al menos 1 fila si `rows` no está vacío, aunque esa única fila ya
 * supere `maxTotalChars` por sí sola (mejor un contexto recortado por otro lado que perder toda la
 * conversación reciente).
 *
 * Pura: solo maneja arrays en memoria, no toca Supabase.
 */
export function capChatHistory(
  rows: readonly ChatMessageRow[],
  limits: { maxMessages: number; maxTotalChars: number }
): ChatMessageRow[] {
  const recent = limits.maxMessages > 0 ? rows.slice(Math.max(0, rows.length - limits.maxMessages)) : rows.slice();

  let totalChars = recent.reduce((sum, row) => sum + row.content.length, 0);
  let start = 0;
  while (totalChars > limits.maxTotalChars && start < recent.length - 1) {
    totalChars -= recent[start].content.length;
    start += 1;
  }

  return recent.slice(start);
}
