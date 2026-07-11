import { formatDate } from "./format";
import type { SummaryResult } from "./summary/format";

export type NoteExportInput = {
  title: string;
  createdAt: string; // ISO
  projectName?: string | null;
  text: string;
  summary?: SummaryResult | null;
};

/**
 * Renders a `SummaryResult` as a Markdown fragment (bold section labels + bullet lists). Shared by
 * the "copy summary" rich-copy button (fed straight into `markdownToSafeHtml`) and by
 * `buildNoteMarkdown`'s "## Resumen" section.
 */
export function summaryToMarkdown(summary: SummaryResult): string {
  const parts = [summary.summary.trim()];
  if (summary.keyPoints.length > 0) {
    parts.push(["**Puntos clave**", ...summary.keyPoints.map((p) => `- ${p}`)].join("\n"));
  }
  if (summary.actionItems.length > 0) {
    parts.push(["**Tareas y próximos pasos**", ...summary.actionItems.map((a) => `- ${a}`)].join("\n"));
  }
  return parts.join("\n\n");
}

function metaLine(createdAt: string, projectName?: string | null): string {
  return [formatDate(createdAt), projectName].filter(Boolean).join(" · ");
}

/**
 * Full "note" as a human-readable Markdown document: title, date (+ project if assigned), the
 * summary (if there's one) and the transcription — for the "Nota completa (.md)" export and
 * nothing else.
 *
 * Deliberately NOT the same format/function as `buildMarkdownExport` in `format.ts`: that one is a
 * YAML-frontmatter + raw-body format that the Google Drive sync engine round-trips byte-for-byte
 * via `parseMarkdownExport` (whatever comes after the frontmatter becomes `transcriptions.text`).
 * Adding a summary section to THAT body would get synced back down as if it were part of the
 * transcription, corrupting it. This function targets a different job — a nicely-structured
 * document for pasting into Docs/Notion or archiving standalone — so it stays fully separate.
 */
export function buildNoteMarkdown({ title, createdAt, projectName, text, summary }: NoteExportInput): string {
  const heading = title.trim() || "Sin título";
  const meta = metaLine(createdAt, projectName);

  const sections = [`# ${heading}`];
  if (meta) sections.push(`_${meta}_`);
  if (summary) sections.push(`## Resumen\n\n${summaryToMarkdown(summary)}`);
  sections.push(`## Transcripción\n\n${text ?? ""}`);
  return sections.join("\n\n");
}

/**
 * Plain-text sibling of `buildNoteMarkdown` — same sections, no Markdown syntax (no `#`/`**`) so
 * it reads cleanly with zero rendering. Used by the "Descargar .txt" button (full note, not just
 * the bare transcription) and, indirectly, whenever the note is copied as plain text.
 */
export function buildNotePlainText({ title, createdAt, projectName, text, summary }: NoteExportInput): string {
  const heading = title.trim() || "Sin título";
  const meta = metaLine(createdAt, projectName);

  const sections = [heading];
  if (meta) sections.push(meta);

  if (summary) {
    const summaryParts = [`Resumen:\n${summary.summary.trim()}`];
    if (summary.keyPoints.length > 0) {
      summaryParts.push(["Puntos clave:", ...summary.keyPoints.map((p) => `- ${p}`)].join("\n"));
    }
    if (summary.actionItems.length > 0) {
      summaryParts.push(["Tareas y próximos pasos:", ...summary.actionItems.map((a) => `- ${a}`)].join("\n"));
    }
    sections.push(summaryParts.join("\n\n"));
  }

  sections.push(`Transcripción:\n${text ?? ""}`);
  return sections.join("\n\n");
}
