import { describe, it, expect } from "vitest";
import { extractSearchTerms, buildSearchSnippet, pickBestSnippet } from "./snippet";

describe("extractSearchTerms", () => {
  it("separa por espacios y compara sin mayúsculas/acentos", () => {
    expect(extractSearchTerms("Reunión Equipo")).toEqual(["reunion", "equipo"]);
  });

  it("descarta el operador de exclusión '-termino' completo (nunca lo resalta)", () => {
    expect(extractSearchTerms("reunión -presupuesto")).toEqual(["reunion"]);
  });

  it("pela comillas de agrupación de frase", () => {
    expect(extractSearchTerms('"reunión de equipo"')).toEqual(["reunion", "de", "equipo"]);
  });

  it("descarta el operador 'or' y tokens de un solo caracter", () => {
    expect(extractSearchTerms("gastos or a")).toEqual(["gastos"]);
  });

  it("deduplica términos repetidos", () => {
    expect(extractSearchTerms("reunión reunión")).toEqual(["reunion"]);
  });

  it("devuelve [] para una query vacía", () => {
    expect(extractSearchTerms("")).toEqual([]);
    expect(extractSearchTerms("   ")).toEqual([]);
  });
});

describe("buildSearchSnippet", () => {
  it("devuelve [] para un source vacío", () => {
    expect(buildSearchSnippet("", "reunión")).toEqual([]);
    expect(buildSearchSnippet("   ", "reunión")).toEqual([]);
  });

  it("resalta la primera coincidencia, sin acentos ni mayúsculas", () => {
    const segments = buildSearchSnippet("Hoy tuvimos una REUNION de equipo muy productiva.", "reunión");
    const match = segments.find((s) => s.match);
    expect(match?.text.toLowerCase()).toBe("reunion");
  });

  it("recorta contexto alrededor del match con elipsis cuando corresponde", () => {
    const longPrefix = "a".repeat(200);
    const source = `${longPrefix} reunión de equipo`;
    const segments = buildSearchSnippet(source, "reunión");
    expect(segments[0].match).toBe(false);
    expect(segments[0].text.startsWith("…")).toBe(true);
    const match = segments.find((s) => s.match);
    expect(match?.text.toLowerCase()).toBe("reunión".toLowerCase());
  });

  it("nunca resalta un término de exclusión ('-termino')", () => {
    const segments = buildSearchSnippet("El presupuesto de este mes quedó cerrado.", "gastos -presupuesto");
    expect(segments.every((s) => !s.match)).toBe(true);
  });

  it("sin coincidencia (p.ej. stemming del lado del server), degrada a un extracto plano sin resaltar", () => {
    // La fila matcheó vía stemming en Postgres ('reunir' ~ 'reuniones') pero acá no hay substring
    // literal — degrada de forma segura, sin lanzar ni devolver un segmento marcado.
    const segments = buildSearchSnippet("Tuvimos varias reuniones esta semana.", "reunir");
    expect(segments.every((s) => !s.match)).toBe(true);
    expect(segments[0].text).toContain("Tuvimos varias reuniones");
  });

  it("trunca un extracto sin match si el texto es muy largo", () => {
    const source = "b".repeat(500);
    const segments = buildSearchSnippet(source, "algo-que-no-aparece");
    expect(segments).toHaveLength(1);
    expect(segments[0].text.endsWith("…")).toBe(true);
    expect(segments[0].text.length).toBeLessThan(source.length);
  });
});

describe("pickBestSnippet", () => {
  it("prefiere el primer candidato con match literal, en el orden recibido", () => {
    const segments = pickBestSnippet(["Sin nada relevante.", "Hoy tuvimos una reunión."], "reunión");
    const match = segments.find((s) => s.match);
    expect(match?.text.toLowerCase()).toBe("reunión");
  });

  it("salta candidatos null/undefined/vacíos", () => {
    const segments = pickBestSnippet([null, undefined, "  ", "Contiene reunión acá."], "reunión");
    expect(segments.some((s) => s.match)).toBe(true);
  });

  it("sin match en NINGÚN candidato, degrada al extracto plano del PRIMERO no vacío", () => {
    const segments = pickBestSnippet(["Primero sin match.", "Segundo tampoco."], "algo-inexistente");
    expect(segments.every((s) => !s.match)).toBe(true);
    expect(segments[0].text).toContain("Primero sin match");
  });

  it("devuelve [] si todos los candidatos están vacíos", () => {
    expect(pickBestSnippet([null, undefined, "   "], "reunión")).toEqual([]);
  });
});
