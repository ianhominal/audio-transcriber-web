import { describe, it, expect } from "vitest";
import { resolveGroqModel, DEFAULT_GROQ_MODEL } from "./model";

describe("resolveGroqModel", () => {
  it("acepta whisper-large-v3-turbo", () => {
    expect(resolveGroqModel("whisper-large-v3-turbo")).toBe("whisper-large-v3-turbo");
  });

  it("acepta whisper-large-v3", () => {
    expect(resolveGroqModel("whisper-large-v3")).toBe("whisper-large-v3");
  });

  it("usa el default si no viene el campo (undefined)", () => {
    expect(resolveGroqModel(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });

  it("usa el default si viene un modelo fuera de la allowlist", () => {
    expect(resolveGroqModel("gpt-4o-transcribe")).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveGroqModel("whisper-large-v3-EXTRA-CARO")).toBe(DEFAULT_GROQ_MODEL);
  });

  it("usa el default si viene vacío o solo espacios", () => {
    expect(resolveGroqModel("")).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveGroqModel("   ")).toBe(DEFAULT_GROQ_MODEL);
  });

  it("usa el default si viene un tipo no-string (form field ausente devuelve null)", () => {
    expect(resolveGroqModel(null)).toBe(DEFAULT_GROQ_MODEL);
  });
});
