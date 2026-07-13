import { describe, it, expect } from "vitest";
import { summaryToMarkdown, buildNoteMarkdown, buildNotePlainText, buildNoteBlocks } from "./noteExport";
import { formatDate } from "./format";
import type { SummaryResult } from "./summary/format";

const SUMMARY: SummaryResult = {
  summary: "Reunión sobre el roadmap del Q3.",
  keyPoints: ["Se prioriza el buscador semántico", "Se descarta el modo offline por ahora"],
  actionItems: ["Armar el proposal de embeddings", "Agendar la demo con el equipo"],
};

// Se calcula con el mismo `formatDate` que usa el código bajo test — el formato exacto
// (con/sin cero inicial, con/sin punto tras el mes) depende del ICU de Node, mismo motivo por el
// que `format.test.ts` no hardcodea la salida de `formatDate` (ver ese archivo).
const CREATED_AT = "2026-07-06T15:40:44Z";
const FORMATTED_DATE = formatDate(CREATED_AT);

describe("summaryToMarkdown", () => {
  it("arma solo el párrafo de resumen si no hay puntos ni tareas", () => {
    const md = summaryToMarkdown({ summary: "Resumen corto.", keyPoints: [], actionItems: [] });
    expect(md).toBe("Resumen corto.");
  });

  it("agrega la sección de puntos clave en negrita + viñetas", () => {
    const md = summaryToMarkdown({ summary: "x", keyPoints: ["Uno", "Dos"], actionItems: [] });
    expect(md).toBe("x\n\n**Puntos clave**\n- Uno\n- Dos");
  });

  it("agrega la sección de tareas en negrita + viñetas", () => {
    const md = summaryToMarkdown({ summary: "x", keyPoints: [], actionItems: ["Hacer A"] });
    expect(md).toBe("x\n\n**Tareas y próximos pasos**\n- Hacer A");
  });

  it("combina resumen + puntos clave + tareas en ese orden", () => {
    expect(summaryToMarkdown(SUMMARY)).toBe(
      [
        "Reunión sobre el roadmap del Q3.",
        "**Puntos clave**\n- Se prioriza el buscador semántico\n- Se descarta el modo offline por ahora",
        "**Tareas y próximos pasos**\n- Armar el proposal de embeddings\n- Agendar la demo con el equipo",
      ].join("\n\n")
    );
  });
});

describe("buildNoteMarkdown", () => {
  it("arma título + fecha + transcripción cuando no hay resumen", () => {
    const md = buildNoteMarkdown({
      title: "Reunión de equipo",
      createdAt: CREATED_AT,
      text: "Hola mundo.",
      summary: null,
    });
    expect(md).toBe(`# Reunión de equipo\n\n_${FORMATTED_DATE}_\n\n## Transcripción\n\nHola mundo.`);
  });

  it("incluye la sección ## Resumen cuando hay resumen", () => {
    const md = buildNoteMarkdown({
      title: "Reunión",
      createdAt: CREATED_AT,
      text: "Texto.",
      summary: { summary: "Resumen breve.", keyPoints: [], actionItems: [] },
    });
    expect(md).toContain("## Resumen\n\nResumen breve.");
    expect(md).toContain("## Transcripción\n\nTexto.");
    // El resumen va antes que la transcripción.
    expect(md.indexOf("## Resumen")).toBeLessThan(md.indexOf("## Transcripción"));
  });

  it("agrega el proyecto a la línea de metadata cuando está presente", () => {
    const md = buildNoteMarkdown({
      title: "Nota",
      createdAt: CREATED_AT,
      projectName: "Trabajo",
      text: "x",
      summary: null,
    });
    expect(md).toContain(`_${FORMATTED_DATE} · Trabajo_`);
  });

  it("usa 'Sin título' si el título viene vacío", () => {
    const md = buildNoteMarkdown({ title: "   ", createdAt: CREATED_AT, text: "x", summary: null });
    expect(md).toContain("# Sin título");
  });

  it("tolera texto vacío", () => {
    const md = buildNoteMarkdown({ title: "Nota", createdAt: CREATED_AT, text: "", summary: null });
    expect(md).toContain("## Transcripción\n\n");
  });
});

describe("buildNotePlainText", () => {
  it("arma título + fecha + transcripción sin sintaxis Markdown", () => {
    const txt = buildNotePlainText({
      title: "Reunión de equipo",
      createdAt: CREATED_AT,
      text: "Hola mundo.",
      summary: null,
    });
    expect(txt).toBe(`Reunión de equipo\n\n${FORMATTED_DATE}\n\nTranscripción:\nHola mundo.`);
    expect(txt).not.toContain("#");
    expect(txt).not.toContain("**");
  });

  it("incluye resumen, puntos clave y tareas como texto plano", () => {
    const txt = buildNotePlainText({
      title: "Reunión",
      createdAt: CREATED_AT,
      text: "Texto.",
      summary: SUMMARY,
    });
    expect(txt).toContain("Resumen:\nReunión sobre el roadmap del Q3.");
    expect(txt).toContain("Puntos clave:\n- Se prioriza el buscador semántico\n- Se descarta el modo offline por ahora");
    expect(txt).toContain(
      "Tareas y próximos pasos:\n- Armar el proposal de embeddings\n- Agendar la demo con el equipo"
    );
    expect(txt).toContain("Transcripción:\nTexto.");
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("##");
  });

  it("usa 'Sin título' si el título viene vacío", () => {
    expect(buildNotePlainText({ title: "", createdAt: CREATED_AT, text: "x", summary: null })).toContain(
      "Sin título"
    );
  });
});

describe("buildNoteBlocks", () => {
  it("el primer bloque siempre es el título", () => {
    const blocks = buildNoteBlocks({ title: "Reunión de equipo", createdAt: CREATED_AT, text: "Hola mundo.", summary: null });
    expect(blocks[0]).toBe("Reunión de equipo");
  });

  it("incluye el bloque de metadata (fecha) cuando no hay resumen", () => {
    const blocks = buildNoteBlocks({ title: "Reunión", createdAt: CREATED_AT, text: "Hola.", summary: null });
    expect(blocks).toEqual(["Reunión", FORMATTED_DATE, "Transcripción:\nHola."]);
  });

  it("agrega el proyecto a la línea de metadata cuando está presente", () => {
    const blocks = buildNoteBlocks({
      title: "Nota",
      createdAt: CREATED_AT,
      projectName: "Trabajo",
      text: "x",
      summary: null,
    });
    expect(blocks[1]).toBe(`${FORMATTED_DATE} · Trabajo`);
  });

  it("separa resumen, puntos clave y tareas en bloques independientes cuando hay resumen", () => {
    const blocks = buildNoteBlocks({ title: "Reunión", createdAt: CREATED_AT, text: "Texto.", summary: SUMMARY });
    expect(blocks).toEqual([
      "Reunión",
      FORMATTED_DATE,
      "Resumen:\nReunión sobre el roadmap del Q3.",
      "Puntos clave:\n- Se prioriza el buscador semántico\n- Se descarta el modo offline por ahora",
      "Tareas y próximos pasos:\n- Armar el proposal de embeddings\n- Agendar la demo con el equipo",
      "Transcripción:\nTexto.",
    ]);
  });

  it("no agrega bloques de puntos clave/tareas si el resumen no los trae", () => {
    const blocks = buildNoteBlocks({
      title: "Reunión",
      createdAt: CREATED_AT,
      text: "Texto.",
      summary: { summary: "Resumen breve.", keyPoints: [], actionItems: [] },
    });
    expect(blocks).toEqual(["Reunión", FORMATTED_DATE, "Resumen:\nResumen breve.", "Transcripción:\nTexto."]);
  });

  it("el bloque de transcripción va siempre último y con el prefijo 'Transcripción:'", () => {
    const blocks = buildNoteBlocks({ title: "Reunión", createdAt: CREATED_AT, text: "Texto final.", summary: SUMMARY });
    expect(blocks[blocks.length - 1]).toBe("Transcripción:\nTexto final.");
  });

  it("no genera bloques vacíos ni de solo espacios (ej. sin fecha/proyecto ni título)", () => {
    const blocks = buildNoteBlocks({ title: "   ", createdAt: "", text: "", summary: null });
    // Sin fecha/proyecto no hay bloque de metadata; el título vacío cae a "Sin título" (nunca "").
    expect(blocks.every((b) => b.trim().length > 0)).toBe(true);
    expect(blocks).toEqual(["Sin título", "Transcripción:\n"]);
  });

  it("no fragmenta una transcripción multi-párrafo (con saltos de línea en blanco) en bloques extra", () => {
    // Regression: antes `buildNoteBlocks` hacía `buildNotePlainText(input).split("\n\n")`, así que
    // cualquier "\n\n" DENTRO de `text` (perfectamente posible en una transcripción real de varios
    // párrafos) se confundía con el separador ENTRE secciones y partía el bloque en dos, dejando el
    // segundo párrafo sin el prefijo "Transcripción:".
    const multiParagraph = "Primer párrafo.\n\nSegundo párrafo.";
    const blocks = buildNoteBlocks({ title: "Reunión", createdAt: CREATED_AT, text: multiParagraph, summary: null });
    expect(blocks).toEqual(["Reunión", FORMATTED_DATE, `Transcripción:\n${multiParagraph}`]);
  });

  it("no fragmenta un resumen multi-párrafo en bloques extra", () => {
    const multiParagraphSummary = "Primer párrafo del resumen.\n\nSegundo párrafo del resumen.";
    const blocks = buildNoteBlocks({
      title: "Reunión",
      createdAt: CREATED_AT,
      text: "Texto.",
      summary: { summary: multiParagraphSummary, keyPoints: [], actionItems: [] },
    });
    expect(blocks).toEqual(["Reunión", FORMATTED_DATE, `Resumen:\n${multiParagraphSummary}`, "Transcripción:\nTexto."]);
  });
});
