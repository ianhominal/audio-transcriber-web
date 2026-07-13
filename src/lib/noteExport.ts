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
 * Shared building block for `buildNotePlainText`/`buildNoteBlocks`: computes the SAME list of
 * plain-text sections (title, metadata, each summary sub-part, transcription) as a real array,
 * rather than as a single joined string. `buildNotePlainText` just joins it; `buildNoteBlocks`
 * returns it as-is. Keeping this as an array (instead of joining then re-splitting on `"\n\n"`)
 * matters because `text`/`summary.summary` can themselves legitimately contain blank-line
 * paragraph breaks (multi-paragraph transcripts/summaries) — splitting a joined string back apart
 * would wrongly fragment those into extra, unlabeled blocks. See `buildNoteBlocks` doc comment.
 */
function buildNoteSections({ title, createdAt, projectName, text, summary }: NoteExportInput): string[] {
  const heading = title.trim() || "Sin título";
  const meta = metaLine(createdAt, projectName);

  const sections = [heading];
  if (meta) sections.push(meta);

  if (summary) {
    sections.push(`Resumen:\n${summary.summary.trim()}`);
    if (summary.keyPoints.length > 0) {
      sections.push(["Puntos clave:", ...summary.keyPoints.map((p) => `- ${p}`)].join("\n"));
    }
    if (summary.actionItems.length > 0) {
      sections.push(["Tareas y próximos pasos:", ...summary.actionItems.map((a) => `- ${a}`)].join("\n"));
    }
  }

  sections.push(`Transcripción:\n${text ?? ""}`);
  return sections;
}

/**
 * Plain-text sibling of `buildNoteMarkdown` — same sections, no Markdown syntax (no `#`/`**`) so
 * it reads cleanly with zero rendering. Used by the "Descargar .txt" button (full note, not just
 * the bare transcription) and, indirectly, whenever the note is copied as plain text.
 */
export function buildNotePlainText(input: NoteExportInput): string {
  return buildNoteSections(input).join("\n\n");
}

/**
 * Mismo contenido que `buildNotePlainText`, pero como un array de bloques (uno por "sección" —
 * título, metadata, cada parte del resumen, transcripción) en vez de un único string. Pensado para
 * los exports a .docx/.pdf: cada bloque se renderiza como un párrafo/heading propio en esos
 * formatos, sin tener que re-derivar título/fecha/proyecto/resumen/transcripción por separado (esa
 * lógica vive UNA sola vez en `buildNoteSections`, compartida con `buildNotePlainText`).
 *
 * Devuelve `buildNoteSections` directamente (NO hace `buildNotePlainText(...).split("\n\n")`):
 * si lo hiciera, un `text`/`summary.summary` con su propio salto de línea en blanco (transcripción
 * o resumen multi-párrafo, algo perfectamente posible) se fragmentaría en bloques extra sin label
 * ("Transcripción:"/"Resumen:" solo quedaría en el primer párrafo). Al construir el array de
 * secciones directamente, cada bloque preserva TODOS sus saltos de línea internos (simples o
 * dobles) tal cual, y el split conflict no puede pasar.
 */
export function buildNoteBlocks(input: NoteExportInput): string[] {
  return buildNoteSections(input).filter((block) => block.trim().length > 0);
}
