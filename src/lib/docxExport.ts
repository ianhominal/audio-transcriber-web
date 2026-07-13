import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { buildNoteBlocks, type NoteExportInput } from "./noteExport";

/**
 * Convierte un bloque (puede traer saltos de línea simples adentro, ej. una lista de viñetas o la
 * transcripción) en los `TextRun` de un único párrafo de Word, usando `break: 1` entre líneas — un
 * `\n` literal dentro de `w:t` no genera un salto de línea visible en Word, así que no alcanza con
 * pasarle el string tal cual a `Paragraph({ text })`.
 */
function blockToRuns(block: string): TextRun[] {
  const lines = block.split("\n");
  return lines.map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined }));
}

/**
 * Genera un .docx de la "nota completa" (título + fecha/proyecto + resumen si existe +
 * transcripción) a partir de los mismos bloques que arma `buildNoteBlocks` — un párrafo de Word
 * por bloque, con el primero (el título) como heading. No reimplementa el armado de
 * título/fecha/proyecto/resumen/transcripción: esa lógica vive UNA sola vez en `noteExport.ts`.
 *
 * Este módulo importa "docx" a nivel de archivo a propósito — solo se debe cargar con un
 * `import()` dinámico desde el componente cliente que lo usa (ver `exportNoteAsDocx` en
 * `transcription-detail.tsx`), nunca de forma estática, para no meter la librería en el bundle
 * inicial ni en un path que corra durante SSR.
 */
export async function exportNoteAsDocx(input: NoteExportInput): Promise<Blob> {
  const [heading, ...rest] = buildNoteBlocks(input);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: heading ?? "Sin título", heading: HeadingLevel.HEADING_1 }),
          ...rest.map((block) => new Paragraph({ children: blockToRuns(block), spacing: { after: 200 } })),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
