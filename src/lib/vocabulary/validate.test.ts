import { describe, it, expect } from "vitest";
import { MAX_TERM_LENGTH, MAX_VOCABULARY_TERMS, sanitizeTerm, canAddVocabularyTerm } from "./validate";

describe("sanitizeTerm", () => {
  it("recorta espacios de borde", () => {
    expect(sanitizeTerm("  Valentino  ")).toBe("Valentino");
  });

  it("devuelve null para un valor vacío después del trim", () => {
    expect(sanitizeTerm("   ")).toBeNull();
    expect(sanitizeTerm("")).toBeNull();
  });

  it("devuelve null para algo que no es string", () => {
    expect(sanitizeTerm(123)).toBeNull();
    expect(sanitizeTerm(null)).toBeNull();
    expect(sanitizeTerm(undefined)).toBeNull();
    expect(sanitizeTerm(["Valentino"])).toBeNull();
  });

  it(`devuelve null si supera ${MAX_TERM_LENGTH} caracteres`, () => {
    const tooLong = "a".repeat(MAX_TERM_LENGTH + 1);
    expect(sanitizeTerm(tooLong)).toBeNull();
  });

  it(`acepta exactamente ${MAX_TERM_LENGTH} caracteres`, () => {
    const exact = "a".repeat(MAX_TERM_LENGTH);
    expect(sanitizeTerm(exact)).toBe(exact);
  });
});

describe("canAddVocabularyTerm", () => {
  it("permite agregar por debajo del máximo", () => {
    expect(canAddVocabularyTerm(0)).toBe(true);
    expect(canAddVocabularyTerm(MAX_VOCABULARY_TERMS - 1)).toBe(true);
  });

  it("bloquea al llegar o superar el máximo", () => {
    expect(canAddVocabularyTerm(MAX_VOCABULARY_TERMS)).toBe(false);
    expect(canAddVocabularyTerm(MAX_VOCABULARY_TERMS + 1)).toBe(false);
  });
});
