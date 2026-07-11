import type { UIMessage } from "ai";

/**
 * Concatenates every `"text"` part of a chat message into one plain string — used by the
 * "Copiar" button on each assistant response (see `ChatPanel`). Non-text parts (reasoning,
 * tool calls, step markers, etc.) are skipped, same as how `ChatPanel` already only *renders*
 * `part.type === "text"` — copying should match what's visibly on screen, not the model's
 * internal reasoning trace.
 */
export function getMessageText(message: Pick<UIMessage, "parts">): string {
  let text = "";
  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}
