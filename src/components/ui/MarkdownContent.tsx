import { markdownToSafeHtml } from "@/lib/markdown";

/**
 * Renders a restricted-Markdown string (see `src/lib/markdown.ts`) as sanitized HTML — the chat's
 * assistant responses and the AI summary, quick win "renderizar markdown en pantalla" (2026-07-11).
 * The ONLY place in the app that calls `dangerouslySetInnerHTML` for model-authored text: safe
 * because `text` here is always Markdown SOURCE, never pre-built HTML, and `markdownToSafeHtml`
 * guarantees `escapeHtml` runs before any tag is opened around it (see that module's doc comment
 * for the full safety argument). Never pass already-rendered HTML into `text` — that would defeat
 * the whole point.
 *
 * `.markdown-body` (`globals.css`) keeps headings/lists/paragraphs sized and spaced to fit inside a
 * chat bubble or a summary card — never full-article typography — and every element inherits
 * `currentColor`/`font-size` from `className`, so it reuses the exact same light/dark tokens as the
 * plain-text version it replaces instead of hardcoding its own palette.
 */
export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className ? `markdown-body ${className}` : "markdown-body"}
      dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(text) }}
    />
  );
}
