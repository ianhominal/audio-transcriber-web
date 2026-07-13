import { describe, it, expect } from "vitest";
import {
  MAX_MERGE_INSTRUCTION_LENGTH,
  MAX_MERGE_INPUT_CHARS,
  MIN_MERGE_NOTES,
  MAX_MERGE_NOTES,
  sanitizeMergeInstruction,
  canMergeNoteCount,
  combineNoteTexts,
  buildMergePrompt,
} from "./validate";
import type { MergeSourceNote } from "./types";

function note(id: string, title: string, createdAt: string, text: string): MergeSourceNote {
  return { id, title, createdAt, text };
}

describe("sanitizeMergeInstruction", () => {
  it("devuelve '' para un valor vacío después del trim", () => {
    expect(sanitizeMergeInstruction("   ")).toBe("");
    expect(sanitizeMergeInstruction("")).toBe("");
  });

  it("devuelve '' para algo que no es string", () => {
    expect(sanitizeMergeInstruction(123)).toBe("");
    expect(sanitizeMergeInstruction(null)).toBe("");
    expect(sanitizeMergeInstruction(undefined)).toBe("");
    expect(sanitizeMergeInstruction({ text: "x" })).toBe("");
  });

  it("recorta espacios de borde", () => {
    expect(sanitizeMergeInstruction("  armá un brief  ")).toBe("armá un brief");
  });

  it(`trunca (no rechaza) si supera ${MAX_MERGE_INSTRUCTION_LENGTH} caracteres`, () => {
    const tooLong = "a".repeat(MAX_MERGE_INSTRUCTION_LENGTH + 500);
    const result = sanitizeMergeInstruction(tooLong);
    expect(result).toHaveLength(MAX_MERGE_INSTRUCTION_LENGTH);
    expect(result).toBe("a".repeat(MAX_MERGE_INSTRUCTION_LENGTH));
  });

  it(`acepta exactamente ${MAX_MERGE_INSTRUCTION_LENGTH} caracteres sin truncar`, () => {
    const exact = "a".repeat(MAX_MERGE_INSTRUCTION_LENGTH);
    expect(sanitizeMergeInstruction(exact)).toBe(exact);
  });

  it("nunca lanza", () => {
    expect(() => sanitizeMergeInstruction(Symbol("x"))).not.toThrow();
    expect(() => sanitizeMergeInstruction([1, 2, 3])).not.toThrow();
  });
});

describe("canMergeNoteCount", () => {
  it(`rechaza por debajo de ${MIN_MERGE_NOTES}`, () => {
    expect(canMergeNoteCount(MIN_MERGE_NOTES - 1)).toBe(false);
    expect(canMergeNoteCount(0)).toBe(false);
  });

  it(`acepta el mínimo (${MIN_MERGE_NOTES})`, () => {
    expect(canMergeNoteCount(MIN_MERGE_NOTES)).toBe(true);
  });

  it(`acepta el máximo (${MAX_MERGE_NOTES})`, () => {
    expect(canMergeNoteCount(MAX_MERGE_NOTES)).toBe(true);
  });

  it(`rechaza por encima de ${MAX_MERGE_NOTES}`, () => {
    expect(canMergeNoteCount(MAX_MERGE_NOTES + 1)).toBe(false);
  });
});

describe("combineNoteTexts", () => {
  it("devuelve vacío para un array vacío", () => {
    expect(combineNoteTexts([])).toEqual({ combinedText: "", truncated: false, includedCount: 0 });
  });

  it("ordena cronológicamente (más vieja primero) aunque el input venga desordenado", () => {
    const notes = [
      note("c", "Tercera", "2026-07-13", "texto C"),
      note("a", "Primera", "2026-07-01", "texto A"),
      note("b", "Segunda", "2026-07-05", "texto B"),
    ];
    const { combinedText } = combineNoteTexts(notes);
    expect(combinedText.indexOf("Primera")).toBeLessThan(combinedText.indexOf("Segunda"));
    expect(combinedText.indexOf("Segunda")).toBeLessThan(combinedText.indexOf("Tercera"));
  });

  it("incluye título y texto de cada nota, sin truncar cuando entra todo", () => {
    const notes = [note("a", "Idea inicial", "2026-07-01", "El contenido de la primera nota.")];
    const { combinedText, truncated, includedCount } = combineNoteTexts(notes);
    expect(combinedText).toContain("Idea inicial");
    expect(combinedText).toContain("El contenido de la primera nota.");
    expect(truncated).toBe(false);
    expect(includedCount).toBe(1);
  });

  it(`trunca cuando el total supera ${MAX_MERGE_INPUT_CHARS} y reporta el includedCount correcto`, () => {
    // Each block adds ~25 chars of framing (title + date + line breaks) on top of the note's text —
    // margin left so 2 full blocks fit under the cap but a third one doesn't.
    const bigText = "x".repeat(MAX_MERGE_INPUT_CHARS / 2 - 100);
    const notes = [
      note("a", "Nota 1", "2026-07-01", bigText),
      note("b", "Nota 2", "2026-07-02", bigText),
      note("c", "Nota 3", "2026-07-03", bigText), // esta no entra
    ];
    const { combinedText, truncated, includedCount } = combineNoteTexts(notes);
    expect(truncated).toBe(true);
    expect(includedCount).toBe(2);
    expect(combinedText.length).toBeLessThanOrEqual(MAX_MERGE_INPUT_CHARS);
    expect(combinedText).not.toContain("Nota 3");
  });

  it("caso límite: una sola nota gigante que sola ya supera el cap — se recorta, includedCount 1", () => {
    const giantText = "y".repeat(MAX_MERGE_INPUT_CHARS + 10_000);
    const notes = [note("a", "Nota gigante", "2026-07-01", giantText)];
    const { combinedText, truncated, includedCount } = combineNoteTexts(notes);
    expect(truncated).toBe(true);
    expect(includedCount).toBe(1);
    expect(combinedText.length).toBeLessThanOrEqual(MAX_MERGE_INPUT_CHARS);
    expect(combinedText).toContain("Nota gigante");
  });
});

describe("buildMergePrompt", () => {
  it("usa la instrucción default cuando instruction === ''", () => {
    const prompt = buildMergePrompt("", "texto combinado de las notas");
    expect(prompt).toContain("Unificá estas notas en un único documento coherente");
    expect(prompt).toContain("texto combinado de las notas");
  });

  it("usa la instrucción del usuario cuando no está vacía", () => {
    const prompt = buildMergePrompt("Armá un outline de guion.", "texto combinado");
    expect(prompt).toContain("Armá un outline de guion.");
    expect(prompt).not.toContain("Unificá estas notas en un único documento coherente");
  });

  it("no lanza con instrucción o texto vacíos", () => {
    expect(() => buildMergePrompt("", "")).not.toThrow();
  });
});
