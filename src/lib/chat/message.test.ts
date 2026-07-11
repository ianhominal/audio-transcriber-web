import { describe, it, expect } from "vitest";
import { getMessageText } from "./message";

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
