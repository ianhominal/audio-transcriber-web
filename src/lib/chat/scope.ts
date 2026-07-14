import type { UIMessage } from "ai";

export type ChatScope = "note" | "all";

export interface ChatRequestConfig {
  api: string;
  body: Record<string, unknown>;
}

/**
 * Pure mapping from chat scope to the request that must be sent. "note" always requires a
 * transcriptionId (throws otherwise — a UI bug, never a valid state); "all" never sends one,
 * matching `/api/brain`'s stateless, note-agnostic retrieval.
 */
export function resolveChatRequestConfig(
  scope: ChatScope,
  transcriptionId: string | undefined,
  message: UIMessage
): ChatRequestConfig {
  if (scope === "note") {
    if (!transcriptionId) {
      throw new Error("Chat scope 'note' requires a transcriptionId.");
    }
    return { api: "/api/chat", body: { transcriptionId, message } };
  }
  return { api: "/api/brain", body: { message } };
}
