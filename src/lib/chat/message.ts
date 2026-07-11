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

/**
 * Whether a chat message's text should go through `markdownToSafeHtml` (see `src/lib/markdown.ts`)
 * before rendering. Only the user's OWN messages are excluded — she types plain prose/questions,
 * never Markdown, so there's nothing to render (and showing literal `*`/`#` back at her if she
 * happens to type them is the CORRECT behavior, not a bug). Everything else (today only
 * `"assistant"`, but also `"system"` if that ever ends up on screen) is model-authored text where
 * Markdown syntax is expected and should render as structure. Same `role !== "user"` split
 * `ChatPanel` already uses for bubble alignment/color — kept here as a named, testable predicate
 * instead of an inline ternary repeated at each render call site.
 */
export function shouldRenderMarkdown(role: UIMessage["role"]): boolean {
  return role !== "user";
}
