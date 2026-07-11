import { describe, it, expect } from "vitest";
import { parseChatErrorMessage } from "./errors";

describe("parseChatErrorMessage", () => {
  it("extrae el mensaje real cuando error.message es el JSON que devuelve el route", () => {
    const error = new Error(JSON.stringify({ error: "Llegaste al límite diario de mensajes de chat. Probá mañana." }));
    expect(parseChatErrorMessage(error)).toBe("Llegaste al límite diario de mensajes de chat. Probá mañana.");
  });

  it("cae al genérico si error.message no es JSON (ej. fallo de red)", () => {
    expect(parseChatErrorMessage(new Error("Failed to fetch"))).toBe(
      "No pudimos generar la respuesta. Probá de nuevo."
    );
  });

  it("cae al genérico si el JSON no tiene la forma { error: string }", () => {
    expect(parseChatErrorMessage(new Error(JSON.stringify({ ok: false })))).toBe(
      "No pudimos generar la respuesta. Probá de nuevo."
    );
    expect(parseChatErrorMessage(new Error(JSON.stringify({ error: 42 })))).toBe(
      "No pudimos generar la respuesta. Probá de nuevo."
    );
    expect(parseChatErrorMessage(new Error(JSON.stringify({ error: "  " })))).toBe(
      "No pudimos generar la respuesta. Probá de nuevo."
    );
  });

  it("cae al genérico ante null/undefined/no-Error sin lanzar", () => {
    expect(parseChatErrorMessage(null)).toBe("No pudimos generar la respuesta. Probá de nuevo.");
    expect(parseChatErrorMessage(undefined)).toBe("No pudimos generar la respuesta. Probá de nuevo.");
    expect(parseChatErrorMessage("string suelto")).toBe("No pudimos generar la respuesta. Probá de nuevo.");
  });
});
