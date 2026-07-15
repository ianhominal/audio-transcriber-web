import { describe, expect, it } from "vitest";
import { buildPolishCall } from "./prompt";

describe("buildPolishCall", () => {
  it("usa el modelo barato de Groq con temperatura 0 (máxima literalidad)", () => {
    const call = buildPolishCall("hola mundo", ["Valentino"]);
    expect(call.model).toBe("llama-3.1-8b-instant");
    expect(call.temperature).toBe(0);
  });

  it("incluye los términos en el prompt del sistema y el texto como mensaje de usuario", () => {
    const call = buildPolishCall("hola balen tino", ["Valentino", "Fulanito FM"]);
    const system = call.messages[0].content;
    expect(system).toContain("Valentino");
    expect(system).toContain("Fulanito FM");
    expect(call.messages[1]).toEqual({ role: "user", content: "hola balen tino" });
  });

  it("tolera una lista de términos vacía sin romper, y de todos modos pide puntuación y párrafos", () => {
    expect(() => buildPolishCall("hola mundo", [])).not.toThrow();
    const call = buildPolishCall("hola mundo", []);
    const system = call.messages[0].content;
    expect(system).toMatch(/puntuaci/i);
    expect(system).toMatch(/párrafo/i);
  });

  it("el prompt prohíbe inventar, resumir, omitir y traducir", () => {
    const call = buildPolishCall("hola", ["Valentino"]);
    const system = call.messages[0].content;
    expect(system).toMatch(/no inventes/i);
    expect(system).toMatch(/no resumas/i);
    expect(system).toMatch(/no omitas/i);
    expect(system).toMatch(/no traduzcas/i);
  });

  it("pide devolver solo el texto final, sin comillas ni preámbulo", () => {
    const call = buildPolishCall("hola", []);
    const system = call.messages[0].content;
    expect(system).toMatch(/solo con el texto final/i);
  });

  it("acota max_tokens de forma proporcional al input y bajo el techo duro", () => {
    const shortCall = buildPolishCall("hola", ["Valentino"]);
    expect(shortCall.max_tokens).toBeGreaterThan(0);
    expect(shortCall.max_tokens).toBeLessThanOrEqual(8000);

    // Un input más largo pide más tokens que uno corto, pero nunca supera el techo.
    const longCall = buildPolishCall("a".repeat(4000), ["Valentino"]);
    expect(longCall.max_tokens).toBeGreaterThan(shortCall.max_tokens);
    expect(longCall.max_tokens).toBeLessThanOrEqual(8000);
  });

  it("capea max_tokens en el techo duro para un texto mucho más grande que un pedazo real", () => {
    // En uso real esta función siempre recibe pedazos de a lo sumo POLISH_CHUNK_CHARS (6.000, ver
    // src/lib/polish/chunk.ts) — este test cubre el caso límite de una llamada directa con un texto
    // mucho más grande, donde el cálculo proporcional (sin techo) pediría muchos más de 8000 tokens.
    const call = buildPolishCall("a".repeat(50_000), []);
    expect(call.max_tokens).toBe(8000);
  });

  it("da margen para que la salida sea al menos una copia completa del input", () => {
    // El pulido devuelve prácticamente una copia del texto (con puntuación/párrafos agregados), así
    // que max_tokens tiene que alcanzar para más tokens de los que ocupa el input en sí — el divisor
    // conservador (2 chars/token) sobreestima respecto de una estimación realista (~4 chars/token).
    const text = "palabra ".repeat(500); // 4.000 caracteres
    const call = buildPolishCall(text, []);
    const realisticInputTokens = text.length / 4;
    expect(call.max_tokens).toBeGreaterThan(realisticInputTokens);
  });
});
