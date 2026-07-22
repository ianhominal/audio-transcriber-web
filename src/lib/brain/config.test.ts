import { describe, it, expect } from "vitest";
import { MAX_BRAIN_QUESTION_CHARS, isValidBrainQuestionText, buildBrainSystemPrompt } from "./config";

describe("isValidBrainQuestionText", () => {
  it("false para vacío o solo espacios", () => {
    expect(isValidBrainQuestionText("")).toBe(false);
    expect(isValidBrainQuestionText("   ")).toBe(false);
  });

  it("true para una pregunta normal", () => {
    expect(isValidBrainQuestionText("¿Qué dije sobre el proyecto de audio?")).toBe(true);
  });

  it(`false si supera ${MAX_BRAIN_QUESTION_CHARS} caracteres`, () => {
    expect(isValidBrainQuestionText("a".repeat(MAX_BRAIN_QUESTION_CHARS + 1))).toBe(false);
  });

  it(`true justo en el límite de ${MAX_BRAIN_QUESTION_CHARS} caracteres`, () => {
    expect(isValidBrainQuestionText("a".repeat(MAX_BRAIN_QUESTION_CHARS))).toBe(true);
  });
});

describe("buildBrainSystemPrompt", () => {
  it("con contexto vacío, instruye a decir que no se encontraron notas (sin inventar)", () => {
    const prompt = buildBrainSystemPrompt("");
    expect(prompt).toContain("no se encontró NINGUNA nota relacionada");
    expect(prompt).not.toContain('"""');
  });

  it("con contexto, lo incluye entre comillas triples y pide grounding estricto", () => {
    const prompt = buildBrainSystemPrompt("## Nota 1 (2026-07-01)\nContenido de prueba.\n\n");
    expect(prompt).toContain("No inventes datos");
    expect(prompt).toContain('"""');
    expect(prompt).toContain("Contenido de prueba.");
  });

  it("es pura: la misma entrada siempre da la misma salida", () => {
    expect(buildBrainSystemPrompt("contexto x")).toBe(buildBrainSystemPrompt("contexto x"));
  });

  it("sin projectName (scope 'all'): el prompt queda idéntico a como estaba antes de este parámetro", () => {
    expect(buildBrainSystemPrompt("## Nota 1 (2026-07-01)\nContenido.\n\n")).toBe(
      buildBrainSystemPrompt("## Nota 1 (2026-07-01)\nContenido.\n\n", undefined)
    );
    expect(buildBrainSystemPrompt("")).toBe(buildBrainSystemPrompt("", undefined));
  });

  it("con projectName (scope 'project'): menciona el proyecto y que la búsqueda está acotada, con contexto", () => {
    const prompt = buildBrainSystemPrompt("## Nota 1 (2026-07-01)\nContenido.\n\n", "Mi Proyecto");
    expect(prompt).toContain("Mi Proyecto");
    expect(prompt).toContain("ACOTADA");
  });

  it("con projectName y contexto vacío: también avisa el scope acotado en el mensaje de 'no encontré nada'", () => {
    const prompt = buildBrainSystemPrompt("", "Mi Proyecto");
    expect(prompt).toContain("no se encontró NINGUNA nota relacionada");
    expect(prompt).toContain("Mi Proyecto");
  });
});
