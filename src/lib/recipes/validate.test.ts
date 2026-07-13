import { describe, it, expect } from "vitest";
import {
  MAX_NAME_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  MAX_RECIPES,
  MAX_RECIPE_INPUT_CHARS,
  sanitizeName,
  sanitizeInstruction,
  canAddRecipe,
  buildRecipePrompt,
} from "./validate";

describe("sanitizeName", () => {
  it("recorta espacios de borde", () => {
    expect(sanitizeName("  Brief de producción  ")).toBe("Brief de producción");
  });

  it("devuelve null para un valor vacío después del trim", () => {
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("")).toBeNull();
  });

  it("devuelve null para algo que no es string", () => {
    expect(sanitizeName(123)).toBeNull();
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
    expect(sanitizeName(["Brief"])).toBeNull();
  });

  it(`devuelve null si supera ${MAX_NAME_LENGTH} caracteres`, () => {
    const tooLong = "a".repeat(MAX_NAME_LENGTH + 1);
    expect(sanitizeName(tooLong)).toBeNull();
  });

  it(`acepta exactamente ${MAX_NAME_LENGTH} caracteres`, () => {
    const exact = "a".repeat(MAX_NAME_LENGTH);
    expect(sanitizeName(exact)).toBe(exact);
  });
});

describe("sanitizeInstruction", () => {
  it("recorta espacios de borde", () => {
    expect(sanitizeInstruction("  Armá 3 hooks para un reel  ")).toBe("Armá 3 hooks para un reel");
  });

  it("devuelve null para un valor vacío después del trim", () => {
    expect(sanitizeInstruction("   ")).toBeNull();
    expect(sanitizeInstruction("")).toBeNull();
  });

  it("devuelve null para algo que no es string", () => {
    expect(sanitizeInstruction(123)).toBeNull();
    expect(sanitizeInstruction(null)).toBeNull();
    expect(sanitizeInstruction(undefined)).toBeNull();
    expect(sanitizeInstruction({ text: "x" })).toBeNull();
  });

  it(`devuelve null si supera ${MAX_INSTRUCTION_LENGTH} caracteres`, () => {
    const tooLong = "a".repeat(MAX_INSTRUCTION_LENGTH + 1);
    expect(sanitizeInstruction(tooLong)).toBeNull();
  });

  it(`acepta exactamente ${MAX_INSTRUCTION_LENGTH} caracteres`, () => {
    const exact = "a".repeat(MAX_INSTRUCTION_LENGTH);
    expect(sanitizeInstruction(exact)).toBe(exact);
  });
});

describe("canAddRecipe", () => {
  it("permite agregar por debajo del máximo", () => {
    expect(canAddRecipe(0)).toBe(true);
    expect(canAddRecipe(MAX_RECIPES - 1)).toBe(true);
  });

  it("bloquea al llegar o superar el máximo", () => {
    expect(canAddRecipe(MAX_RECIPES)).toBe(false);
    expect(canAddRecipe(MAX_RECIPES + 1)).toBe(false);
  });
});

describe("buildRecipePrompt", () => {
  it("incluye la instrucción del usuario y el texto de la transcripción", () => {
    const prompt = buildRecipePrompt("Armá un brief con objetivo, público y tono.", "Hola, esto es una nota.");
    expect(prompt).toContain("Armá un brief con objetivo, público y tono.");
    expect(prompt).toContain("Hola, esto es una nota.");
  });

  it("el texto de la transcripción aparece DESPUÉS de la instrucción (la instrucción manda)", () => {
    const prompt = buildRecipePrompt("INSTRUCCION_X", "TEXTO_Y");
    expect(prompt.indexOf("INSTRUCCION_X")).toBeLessThan(prompt.indexOf("TEXTO_Y"));
  });

  it(`recorta el texto de la transcripción a ${MAX_RECIPE_INPUT_CHARS} caracteres`, () => {
    const longText = "a".repeat(MAX_RECIPE_INPUT_CHARS + 500);
    const prompt = buildRecipePrompt("instrucción", longText);
    // El texto incluido en el prompt nunca supera el cap, aunque el prompt total sea más largo
    // (framing + instrucción alrededor).
    const includedText = "a".repeat(MAX_RECIPE_INPUT_CHARS);
    expect(prompt).toContain(includedText);
    expect(prompt).not.toContain("a".repeat(MAX_RECIPE_INPUT_CHARS + 1));
  });

  it("no lanza con instrucción o texto vacíos", () => {
    expect(() => buildRecipePrompt("", "")).not.toThrow();
  });
});
