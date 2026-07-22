import type { UIMessage } from "ai";

export type ChatScope = "note" | "all" | "project";

export interface ChatRequestConfig {
  api: string;
  body: Record<string, unknown>;
}

/**
 * Pure mapping from chat scope to the request that must be sent. "note" always requires a
 * transcriptionId (throws otherwise — a UI bug, never a valid state); "all" never sends one,
 * matching `/api/brain`'s stateless, note-agnostic retrieval. "project" ("Este proyecto") also hits
 * `/api/brain` — same stateless endpoint as "all" — but narrows retrieval to one project via
 * `projectId` in the body (see `RetrievalFilters.projectId`, `src/lib/brain/retrieval.ts`); it
 * requires a `projectId` for the same reason "note" requires a `transcriptionId` (a UI bug, never a
 * valid state to reach without one).
 */
export function resolveChatRequestConfig(
  scope: ChatScope,
  transcriptionId: string | undefined,
  message: UIMessage,
  projectId?: string
): ChatRequestConfig {
  if (scope === "note") {
    if (!transcriptionId) {
      throw new Error("Chat scope 'note' requires a transcriptionId.");
    }
    return { api: "/api/chat", body: { transcriptionId, message } };
  }
  if (scope === "project") {
    if (!projectId) {
      throw new Error("Chat scope 'project' requires a projectId.");
    }
    return { api: "/api/brain", body: { message, projectId } };
  }
  return { api: "/api/brain", body: { message } };
}
