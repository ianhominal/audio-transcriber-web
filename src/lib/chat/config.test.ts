import { describe, it, expect } from "vitest";
import {
  MAX_CHAT_CONTEXT_INPUT_CHARS,
  MAX_CHAT_MESSAGE_CHARS,
  isValidChatMessageText,
  buildChatSystemPrompt,
} from "./config";

describe("isValidChatMessageText", () => {
  it("acepta un mensaje corto no vacío", () => {
    expect(isValidChatMessageText("¿De qué habla esto?")).toBe(true);
  });

  it("rechaza vacío o solo espacios", () => {
    expect(isValidChatMessageText("")).toBe(false);
    expect(isValidChatMessageText("   \n  ")).toBe(false);
  });

  it("acepta exactamente en el límite y rechaza uno más", () => {
    const atLimit = "a".repeat(MAX_CHAT_MESSAGE_CHARS);
    const overLimit = "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1);
    expect(isValidChatMessageText(atLimit)).toBe(true);
    expect(isValidChatMessageText(overLimit)).toBe(false);
  });

  it("ignora espacios de borde al medir el largo", () => {
    const padded = `  ${"a".repeat(MAX_CHAT_MESSAGE_CHARS)}  `;
    expect(isValidChatMessageText(padded)).toBe(true);
  });
});

describe("buildChatSystemPrompt", () => {
  it("incluye el texto de la transcripción completo cuando está bajo el cap", () => {
    const prompt = buildChatSystemPrompt("Hola, esto es una prueba de transcripción.");
    expect(prompt).toContain("Hola, esto es una prueba de transcripción.");
  });

  it("recorta el texto a MAX_CHAT_CONTEXT_INPUT_CHARS", () => {
    const longText = "x".repeat(MAX_CHAT_CONTEXT_INPUT_CHARS + 5_000);
    const prompt = buildChatSystemPrompt(longText);
    expect(prompt).not.toContain("x".repeat(MAX_CHAT_CONTEXT_INPUT_CHARS + 1));
    // La corrida más larga de "x" seguidas viene del texto inyectado (recortado); el resto del
    // prompt (instrucciones fijas) puede tener alguna "x" suelta (ej. "explícitamente"), por eso se
    // mide la corrida MÁS LARGA en vez del total de apariciones.
    const longestRun = Math.max(...(prompt.match(/x+/g) ?? [""]).map((run) => run.length));
    expect(longestRun).toBe(MAX_CHAT_CONTEXT_INPUT_CHARS);
  });

  it("incluye la regla anti-alucinación (grounding) y el idioma español", () => {
    const prompt = buildChatSystemPrompt("texto de ejemplo");
    expect(prompt.toLowerCase()).toContain("no inventes");
    expect(prompt.toLowerCase()).toContain("español");
  });
});
