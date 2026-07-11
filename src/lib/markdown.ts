/**
 * Markdown *source* → sanitized HTML, for the "copy with formatting" feature (copy button on the
 * transcription, the summary, and each chat response — see `CopyButton`/`clipboard.ts`). Pasting
 * that HTML into Google Docs / Notion / mail keeps structure (headings, bold, bullets) instead of
 * a flat blob of text.
 *
 * NOT related to `buildMarkdownExport`/`parseMarkdownExport` in `format.ts` — those build/parse
 * the YAML-frontmatter file format the Google Drive sync engine round-trips (see comment there).
 * This module never touches that format.
 *
 * Deliberately a SMALL, restricted grammar (headings, bold, italic, bullet/numbered lists,
 * paragraphs) instead of a full CommonMark implementation or a 3rd-party parser: no links, no
 * images, no raw-HTML passthrough — every character of user text is escaped via `escapeHtml`
 * BEFORE any tag is added around it, and the only way to produce a tag is one of the few
 * recognized markdown tokens below. That makes it safe-by-construction (there's no attribute/URL
 * surface like `href`/`src` to sanitize) rather than "sanitize arbitrary HTML after the fact".
 */

/** Escapes text for safe insertion into HTML (both as element content and as this module uses it —
 *  never as an unquoted attribute value, since this module never emits attributes). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_STAR_RE = /(^|[^*])\*([^*]+)\*(?!\*)/g;
const ITALIC_UNDERSCORE_RE = /\b_([^_]+)_\b/g;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(?:-|\*|\+)\s+/;
const ORDERED_RE = /^\d+\.\s+/;

/**
 * Applies inline formatting (bold/italic) to a line that's ALREADY been through `escapeHtml`.
 * Order matters: bold first, so `**x**` isn't eaten by the italic pattern. Running this AFTER
 * escaping (not before) is the safety property this whole module relies on — the regexes below
 * only ever match literal `*`/`_` characters (untouched by `escapeHtml`) and wrap already-safe
 * text, so there's no way for user content to open/close a tag it didn't already have escaped.
 */
function renderInline(escapedText: string): string {
  let html = escapedText;
  html = html.replace(BOLD_RE, "<strong>$1</strong>");
  html = html.replace(ITALIC_STAR_RE, "$1<em>$2</em>");
  html = html.replace(ITALIC_UNDERSCORE_RE, "<em>$1</em>");
  return html;
}

/** Escapes + applies inline formatting to one line of raw source text. */
function renderInlineLine(rawLine: string): string {
  return renderInline(escapeHtml(rawLine));
}

/** Converts a restricted Markdown subset to sanitized HTML — see module doc for the exact grammar
 *  and the safety argument. Unknown/unrecognized syntax (links, code fences, blockquotes, tables,
 *  raw HTML, 7+ `#`) is treated as literal paragraph text, never as structure. */
export function markdownToSafeHtml(markdown: string): string {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineLine(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, "").trim());
        i++;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineLine(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(lines[i].replace(ORDERED_RE, "").trim());
        i++;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineLine(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !HEADING_RE.test(lines[i]) && !BULLET_RE.test(lines[i]) && !ORDERED_RE.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${paraLines.map(renderInlineLine).join("<br>")}</p>`);
  }

  return blocks.join("\n");
}
