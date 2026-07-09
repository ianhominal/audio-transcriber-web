import { describe, it, expect } from "vitest";
import {
  resolveTranslationLanguage,
  translationLanguageLabel,
  resolveTranscribeMode,
  DEFAULT_TRANSLATION_LANGUAGE,
  DEFAULT_TRANSCRIBE_MODE,
} from "./languages";

describe("resolveTranslationLanguage", () => {
  it("acepta un código de la allowlist", () => {
    expect(resolveTranslationLanguage("pt")).toBe("pt");
  });

  it("cae al default ante un código fuera de la allowlist", () => {
    expect(resolveTranslationLanguage("xx")).toBe(DEFAULT_TRANSLATION_LANGUAGE);
  });

  it("cae al default ante valores no-string (input arbitrario del cliente)", () => {
    expect(resolveTranslationLanguage(undefined)).toBe(DEFAULT_TRANSLATION_LANGUAGE);
    expect(resolveTranslationLanguage(null)).toBe(DEFAULT_TRANSLATION_LANGUAGE);
    expect(resolveTranslationLanguage(42)).toBe(DEFAULT_TRANSLATION_LANGUAGE);
  });

  it("recorta espacios antes de validar", () => {
    expect(resolveTranslationLanguage(" fr ")).toBe("fr");
  });
});

describe("translationLanguageLabel", () => {
  it("devuelve el nombre legible de un código válido", () => {
    expect(translationLanguageLabel("de")).toBe("Alemán");
  });

  it("devuelve el código tal cual si no está en la lista (defensivo)", () => {
    expect(translationLanguageLabel("xx")).toBe("xx");
  });
});

describe("resolveTranscribeMode", () => {
  it("acepta 'translate'", () => {
    expect(resolveTranscribeMode("translate")).toBe("translate");
  });

  it("cae al default ('transcribe') ante cualquier otro valor", () => {
    expect(resolveTranscribeMode("otra-cosa")).toBe(DEFAULT_TRANSCRIBE_MODE);
    expect(resolveTranscribeMode(undefined)).toBe(DEFAULT_TRANSCRIBE_MODE);
  });
});
