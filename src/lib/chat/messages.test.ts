import { describe, it, expect } from "vitest";
import { extractUiMessageText, rowsToUIMessages } from "./messages";

describe("extractUiMessageText", () => {
  it("concatena las partes de texto en orden", () => {
    const text = extractUiMessageText({
      parts: [
        { type: "text", text: "Hola " },
        { type: "text", text: "mundo" },
      ],
    });
    expect(text).toBe("Hola mundo");
  });

  it("ignora partes que no son de texto (tool, reasoning, etc.)", () => {
    const text = extractUiMessageText({
      parts: [
        { type: "reasoning", text: "pensando..." },
        { type: "text", text: "Respuesta final" },
        { type: "tool-someTool" },
      ],
    });
    expect(text).toBe("Respuesta final");
  });

  it("devuelve string vacío sin partes o con parts undefined", () => {
    expect(extractUiMessageText({ parts: [] })).toBe("");
    expect(extractUiMessageText({})).toBe("");
  });

  it("no lanza ante una parte de texto con `text` en forma inesperada", () => {
    const text = extractUiMessageText({
      parts: [{ type: "text", text: undefined }, { type: "text", text: "ok" }],
    });
    expect(text).toBe("ok");
  });
});

describe("rowsToUIMessages", () => {
  it("mapea filas de chat_messages a UIMessage[] con una parte de texto cada una", () => {
    const messages = rowsToUIMessages([
      { id: "m1", role: "user", content: "¿De qué habla esto?" },
      { id: "m2", role: "assistant", content: "Habla de..." },
    ]);

    expect(messages).toEqual([
      { id: "m1", role: "user", parts: [{ type: "text", text: "¿De qué habla esto?" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "Habla de..." }] },
    ]);
  });

  it("devuelve array vacío para historial vacío", () => {
    expect(rowsToUIMessages([])).toEqual([]);
  });

  it("preserva el orden de entrada (se asume ya cronológico, ordenado por el caller)", () => {
    const messages = rowsToUIMessages([
      { id: "a", role: "user", content: "1" },
      { id: "b", role: "assistant", content: "2" },
      { id: "c", role: "user", content: "3" },
    ]);
    expect(messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
