import { markdownToSafeHtml } from "./markdown";

/**
 * Copies `text` to the clipboard as plain text. Tries the async Clipboard API first; if
 * unavailable (insecure context, old browser) or denied, falls back to the legacy
 * `document.execCommand("copy")` via a temporary off-screen textarea — same fallback chain already
 * used by `copyToClipboard` in `ajustes/mcp-tokens-section.tsx` (kept as a separate copy here
 * rather than importing across those feature folders, to keep this "quick win" scoped to its own
 * files; worth consolidating into one shared util if a third call site shows up). Never throws —
 * returns `false` if nothing worked, so the caller can show an error instead of a false "Copiado ✓".
 *
 * DOM-only, not unit tested (this repo's Vitest runs in `environment: "node"`, see
 * `vitest.config.mts` — UI/DOM flows are covered by Playwright under `/e2e` instead).
 */
export async function copyPlainText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through to the legacy fallback below (e.g. permission denied by the browser).
    }
  }
  if (typeof document === "undefined") return false;
  // `finally` (no solo el happy path) limpia el textarea temporal incluso si `execCommand` tira
  // en vez de devolver `false` (pasa en algunos contextos restringidos) — bugfix LOW, review
  // adversarial 2026-07-11: sin esto, una excepción ahí dejaba un <textarea> vacío huérfano en el
  // body para siempre (invisible pero igual tabulable). Mismo bug preexistente en el
  // `copyToClipboard` de `ajustes/mcp-tokens-section.tsx`, no tocado acá (fuera de scope).
  const textarea = document.createElement("textarea");
  try {
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Copies `markdown` to the clipboard with BOTH a rich `text/html` representation (rendered via
 * `markdownToSafeHtml` — headings/bold/bullets preserved, all literal text escaped) and a
 * `text/plain` fallback (the raw markdown/text, untouched — for plain prose like the transcription
 * or a chat reply this reads as clean text; for the summary's Markdown-built source
 * (`summaryToMarkdown`) it still shows literal `**`/`-` syntax in a plain-text target, same
 * tradeoff the task asked for: text/plain is explicitly "el markdown crudo", not a second render).
 * Pasting into a rich-text target (Google Docs, Notion, Gmail) keeps structure either way.
 *
 * Falls back to `copyPlainText` (writeText → legacy execCommand) when the browser doesn't support
 * `navigator.clipboard.write`/`ClipboardItem`, when `text/html` isn't an accepted `ClipboardItem`
 * MIME type, or when the permission is denied — any failure of the rich path is swallowed and
 * retried as plain text rather than surfaced, so the user only sees a real error if BOTH paths fail.
 */
export async function copyRichText(markdown: string): Promise<boolean> {
  const text = markdown ?? "";
  if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const html = markdownToSafeHtml(text);
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Falls through to the plain-text fallback below.
    }
  }
  return copyPlainText(text);
}
