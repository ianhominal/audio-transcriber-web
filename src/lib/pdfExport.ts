import { jsPDF } from "jspdf";
import { buildNoteBlocks, type NoteExportInput } from "./noteExport";

const PAGE_MARGIN = 15; // mm
const HEADING_FONT_SIZE = 16;
const BODY_FONT_SIZE = 11;
const LINE_HEIGHT = 6; // mm, aprox. para BODY_FONT_SIZE con jsPDF default (~1.15 * pt→mm)
const BLOCK_SPACING = 4; // mm extra entre bloques

/**
 * Genera un PDF de la "nota completa" (título + fecha/proyecto + resumen si existe +
 * transcripción) a partir de los mismos bloques que arma `buildNoteBlocks` — un párrafo por
 * bloque, con el primero (el título) en fuente más grande/negrita, paginando manualmente cuando el
 * contenido supera el alto de la página. No reimplementa el armado de
 * título/fecha/proyecto/resumen/transcripción: esa lógica vive UNA sola vez en `noteExport.ts`.
 *
 * Este módulo importa "jspdf" a nivel de archivo a propósito — solo se debe cargar con un
 * `import()` dinámico desde el componente cliente que lo usa (ver `exportNoteAsPdf` en
 * `transcription-detail.tsx`), nunca de forma estática, para no meter la librería en el bundle
 * inicial ni en un path que corra durante SSR.
 *
 * Fuente por defecto (helvetica): jsPDF auto-encodea el rango Latin-1 (incluye á/é/í/ó/ú/ñ/¿/¡ y
 * mayúsculas equivalentes) vía su tabla WinAnsi interna, así que el texto en español se imprime
 * bien sin embeber fuentes custom.
 */
export async function exportNoteAsPdf(input: NoteExportInput): Promise<jsPDF> {
  const [heading, ...rest] = buildNoteBlocks(input);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - PAGE_MARGIN * 2;

  let y = PAGE_MARGIN;

  function ensureSpace(neededHeight: number) {
    if (y + neededHeight > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  }

  function writeBlock(text: string, fontSize: number, bold: boolean) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    // splitTextToSize ya respira los "\n" internos del bloque (bullets, líneas de la
    // transcripción) como líneas separadas dentro del wrap.
    const lines: string[] = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      ensureSpace(LINE_HEIGHT);
      doc.text(line, PAGE_MARGIN, y);
      y += LINE_HEIGHT;
    }
  }

  writeBlock(heading ?? "Sin título", HEADING_FONT_SIZE, true);
  y += BLOCK_SPACING;

  for (const block of rest) {
    writeBlock(block, BODY_FONT_SIZE, false);
    y += BLOCK_SPACING;
  }

  return doc;
}
