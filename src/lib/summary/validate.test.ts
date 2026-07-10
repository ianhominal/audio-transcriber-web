import { describe, it, expect } from "vitest";
import { canSummarizeText, MIN_SUMMARY_TEXT_LENGTH } from "./validate";

describe("canSummarizeText", () => {
  it("rechaza texto vacío", () => {
    expect(canSummarizeText("")).toBe(false);
  });

  it("rechaza texto corto (solo espacios no cuentan)", () => {
    expect(canSummarizeText("   probando   ")).toBe(false);
  });

  it("acepta texto que llega al mínimo", () => {
    const text = "a".repeat(MIN_SUMMARY_TEXT_LENGTH);
    expect(canSummarizeText(text)).toBe(true);
  });

  it("rechaza texto un caracter por debajo del mínimo", () => {
    const text = "a".repeat(MIN_SUMMARY_TEXT_LENGTH - 1);
    expect(canSummarizeText(text)).toBe(false);
  });

  it("ignora espacios en blanco al rededor al medir el largo", () => {
    const padded = `  ${"a".repeat(MIN_SUMMARY_TEXT_LENGTH)}  `;
    expect(canSummarizeText(padded)).toBe(true);
  });
});
