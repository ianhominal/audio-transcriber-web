import { describe, expect, it } from "vitest";
import { joinPolished, POLISH_CHUNK_CHARS, splitForPolish } from "./chunk";

/** Texto tipo transcripción de reunión: sin puntuación fiable, párrafos irregulares. */
function meetingLikeText(chars: number): string {
  const words = ["bueno", "eso", "sería", "el", "pitch", "de", "Cadejos", "y", "el", "scope", "del", "vertical", "slice"];
  let out = "";
  let i = 0;
  while (out.length < chars) {
    out += words[i % words.length] + (i % 37 === 0 ? ".\n\n" : " ");
    i++;
  }
  return out.slice(0, chars);
}

describe("splitForPolish — invariante de no perder texto", () => {
  // Esta es LA garantía del módulo: si esto falla, alguien pierde parte de su reunión.
  it("concatenar los pedazos reconstruye el original, exacto", () => {
    const text = meetingLikeText(50_000);
    expect(splitForPolish(text).join("")).toBe(text);
  });

  it("mantiene la invariante con texto sin NINGÚN espacio (peor caso, corte duro)", () => {
    const text = "x".repeat(20_000);
    const chunks = splitForPolish(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= POLISH_CHUNK_CHARS)).toBe(true);
  });

  it("mantiene la invariante en tamaños variados, incluidos los bordes exactos", () => {
    for (const size of [1, 999, POLISH_CHUNK_CHARS - 1, POLISH_CHUNK_CHARS, POLISH_CHUNK_CHARS + 1, 13_337]) {
      const text = meetingLikeText(size);
      expect(splitForPolish(text).join(""), `falló con size=${size}`).toBe(text);
    }
  });

  it("mantiene la invariante con acentos y emojis (nada de romper caracteres)", () => {
    const text = "áéíóú ñ 🎙️ こんにちは ".repeat(2_000);
    expect(splitForPolish(text).join("")).toBe(text);
  });

  it("simula la reunión real de 3 horas (~180k caracteres) sin perder nada", () => {
    const text = meetingLikeText(180_000);
    const chunks = splitForPolish(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= POLISH_CHUNK_CHARS)).toBe(true);
  });
});

describe("splitForPolish — tamaños y cortes", () => {
  it("un texto corto queda en un solo pedazo", () => {
    expect(splitForPolish("hola mundo")).toEqual(["hola mundo"]);
  });

  it("un texto vacío no genera pedazos", () => {
    expect(splitForPolish("")).toEqual([]);
  });

  it("ningún pedazo supera el tope", () => {
    const chunks = splitForPolish(meetingLikeText(100_000));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(POLISH_CHUNK_CHARS);
  });

  it("prefiere cortar en el límite de un párrafo", () => {
    const head = "a".repeat(80);
    const tail = "b".repeat(80);
    const chunks = splitForPolish(`${head}\n\n${tail}`, 100);
    expect(chunks[0]).toBe(`${head}\n\n`);
    expect(chunks.join("")).toBe(`${head}\n\n${tail}`);
  });

  it("si no hay párrafo, corta al final de una oración", () => {
    const text = `${"a".repeat(60)}. ${"b".repeat(60)}`;
    const chunks = splitForPolish(text, 100);
    expect(chunks[0].endsWith(".")).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("rechaza un tamaño de pedazo inválido en vez de colgarse", () => {
    expect(() => splitForPolish("hola", 0)).toThrow();
  });
});

describe("joinPolished", () => {
  it("une los pedazos pulidos con una línea en blanco", () => {
    expect(joinPolished(["Uno.", "Dos."])).toBe("Uno.\n\nDos.");
  });

  it("descarta pedazos vacíos y limpia los bordes", () => {
    expect(joinPolished(["  Uno.  ", "   ", "", "Dos."])).toBe("Uno.\n\nDos.");
  });

  it("con un solo pedazo devuelve ese pedazo", () => {
    expect(joinPolished(["  Solo esto.  "])).toBe("Solo esto.");
  });
});
