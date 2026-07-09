import { describe, it, expect } from "vitest";
import {
  resolveLanguage,
  resolveEngine,
  resolveQuality,
  DEFAULT_LANGUAGE,
  DEFAULT_ENGINE,
} from "./validate";
import { DEFAULT_GROQ_MODEL } from "@/lib/transcribe/model";

describe("resolveLanguage", () => {
  it("acepta es/en/auto", () => {
    expect(resolveLanguage("es")).toBe("es");
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("auto")).toBe("auto");
  });

  it("usa el default ante valores fuera de la allowlist, vacíos o no-string", () => {
    expect(resolveLanguage("fr")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage("")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage("   ")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(42)).toBe(DEFAULT_LANGUAGE);
  });
});

describe("resolveEngine", () => {
  it("acepta groq (único motor soportado en la web hoy)", () => {
    expect(resolveEngine("groq")).toBe("groq");
  });

  it("usa el default ante valores fuera de la allowlist, vacíos o no-string", () => {
    expect(resolveEngine("openai")).toBe(DEFAULT_ENGINE);
    expect(resolveEngine("")).toBe(DEFAULT_ENGINE);
    expect(resolveEngine(undefined)).toBe(DEFAULT_ENGINE);
    expect(resolveEngine(null)).toBe(DEFAULT_ENGINE);
  });
});

describe("resolveQuality", () => {
  it("delega en la allowlist de Groq (mismo criterio que /api/transcribe)", () => {
    expect(resolveQuality("whisper-large-v3")).toBe("whisper-large-v3");
    expect(resolveQuality("whisper-large-v3-turbo")).toBe("whisper-large-v3-turbo");
    expect(resolveQuality("gpt-4o-transcribe")).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveQuality(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });
});
