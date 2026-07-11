import { describe, it, expect } from "vitest";
import { extractUiMessageText, rowsToUIMessages, capChatHistory, type ChatMessageRow } from "./messages";

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

describe("capChatHistory", () => {
  function rows(n: number, contentLength = 10): ChatMessageRow[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "x".repeat(contentLength),
    }));
  }

  it("devuelve todo tal cual si está por debajo de ambos topes", () => {
    const input = rows(4, 10);
    expect(capChatHistory(input, { maxMessages: 40, maxTotalChars: 1_000 })).toEqual(input);
  });

  it("recorta por cantidad de mensajes, quedándose con los ÚLTIMOS", () => {
    const input = rows(10, 5);
    const result = capChatHistory(input, { maxMessages: 3, maxTotalChars: 1_000 });
    expect(result.map((r) => r.id)).toEqual(["m7", "m8", "m9"]);
  });

  it("recorta por presupuesto de caracteres, descartando desde los MÁS VIEJOS", () => {
    // 5 filas de 10 chars cada una = 50 chars totales; presupuesto de 25 debería dejar solo las
    // últimas 2 (20 chars) — la 3ra desde el final (30 chars) ya se pasa.
    const input = rows(5, 10);
    const result = capChatHistory(input, { maxMessages: 40, maxTotalChars: 25 });
    expect(result.map((r) => r.id)).toEqual(["m3", "m4"]);
  });

  it("aplica primero el cap de cantidad y DESPUÉS el de caracteres sobre lo que quedó", () => {
    const input = rows(10, 10); // 10 filas de 10 chars
    const result = capChatHistory(input, { maxMessages: 4, maxTotalChars: 25 });
    // Tras el cap de cantidad quedan m6..m9 (40 chars); el cap de chars deja solo las últimas 2.
    expect(result.map((r) => r.id)).toEqual(["m8", "m9"]);
  });

  it("deja al menos 1 fila aunque una sola ya supere maxTotalChars", () => {
    const input = rows(3, 100);
    const result = capChatHistory(input, { maxMessages: 40, maxTotalChars: 10 });
    expect(result.map((r) => r.id)).toEqual(["m2"]);
  });

  it("array vacío devuelve array vacío sin lanzar", () => {
    expect(capChatHistory([], { maxMessages: 40, maxTotalChars: 1_000 })).toEqual([]);
  });

  it("maxMessages <= 0 no filtra por cantidad (solo aplica el cap de caracteres)", () => {
    const input = rows(3, 10);
    const result = capChatHistory(input, { maxMessages: 0, maxTotalChars: 1_000 });
    expect(result).toEqual(input);
  });
});
