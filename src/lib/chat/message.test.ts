import { describe, it, expect } from "vitest";
import { getMessageText, shouldRenderMarkdown } from "./message";

describe("getMessageText", () => {
  it("devuelve el texto de una parte 'text' única", () => {
    expect(getMessageText({ parts: [{ type: "text", text: "Hola, ¿en qué te ayudo?" }] })).toBe(
      "Hola, ¿en qué te ayudo?"
    );
  });

  it("concatena varias partes 'text' en orden", () => {
    expect(
      getMessageText({
        parts: [
          { type: "text", text: "Primera parte. " },
          { type: "text", text: "Segunda parte." },
        ],
      })
    ).toBe("Primera parte. Segunda parte.");
  });

  it("ignora partes que no son 'text' (reasoning, step-start, tool, etc.)", () => {
    expect(
      getMessageText({
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "pensando en voz baja..." },
          { type: "text", text: "Respuesta visible." },
        ],
      })
    ).toBe("Respuesta visible.");
  });

  it("devuelve cadena vacía si no hay partes de texto", () => {
    expect(getMessageText({ parts: [{ type: "step-start" }] })).toBe("");
    expect(getMessageText({ parts: [] })).toBe("");
  });
});

describe("shouldRenderMarkdown", () => {
  it("la usuaria escribe texto plano — sus mensajes NUNCA se renderizan como markdown", () => {
    expect(shouldRenderMarkdown("user")).toBe(false);
  });

  it("las respuestas del asistente sí se renderizan como markdown", () => {
    expect(shouldRenderMarkdown("assistant")).toBe(true);
  });

  it("un rol 'system' (si alguna vez llegara a pintarse) se trata igual que el asistente, no como la usuaria", () => {
    expect(shouldRenderMarkdown("system")).toBe(true);
  });
});
