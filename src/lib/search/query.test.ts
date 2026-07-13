import { describe, it, expect } from "vitest";
import { MAX_SEARCH_QUERY_CHARS, sanitizeSearchQuery, isValidSearchQuery, buildIlikeOrFilter } from "./query";

describe("sanitizeSearchQuery", () => {
  it("devuelve '' para un valor vacío o solo espacios", () => {
    expect(sanitizeSearchQuery("")).toBe("");
    expect(sanitizeSearchQuery("   ")).toBe("");
  });

  it("devuelve '' para algo que no es string", () => {
    expect(sanitizeSearchQuery(123)).toBe("");
    expect(sanitizeSearchQuery(null)).toBe("");
    expect(sanitizeSearchQuery(undefined)).toBe("");
    expect(sanitizeSearchQuery(["reunión"])).toBe("");
    expect(sanitizeSearchQuery({ q: "reunión" })).toBe("");
  });

  it("recorta espacios de borde", () => {
    expect(sanitizeSearchQuery("  reunión de equipo  ")).toBe("reunión de equipo");
  });

  it(`trunca (no rechaza) si supera ${MAX_SEARCH_QUERY_CHARS} caracteres`, () => {
    const tooLong = "a".repeat(MAX_SEARCH_QUERY_CHARS + 500);
    const result = sanitizeSearchQuery(tooLong);
    expect(result).toHaveLength(MAX_SEARCH_QUERY_CHARS);
    expect(result).toBe("a".repeat(MAX_SEARCH_QUERY_CHARS));
  });

  it("preserva operadores de websearch_to_tsquery tal cual (comillas, OR, exclusión con '-')", () => {
    // No hay sanitización de operadores: websearch_to_tsquery nunca lanza error de sintaxis y el
    // valor viaja como parámetro bindeado (no concatenado a SQL), así que no hace falta escaparlos.
    expect(sanitizeSearchQuery('"reunión de equipo" -presupuesto OR gastos')).toBe(
      '"reunión de equipo" -presupuesto OR gastos'
    );
  });
});

describe("isValidSearchQuery", () => {
  it("true para una query no vacía", () => {
    expect(isValidSearchQuery("reunión")).toBe(true);
  });

  it("false para vacío o solo espacios", () => {
    expect(isValidSearchQuery("")).toBe(false);
    expect(isValidSearchQuery("   ")).toBe(false);
  });
});

describe("buildIlikeOrFilter", () => {
  it("arma una condición ilike por columna, unidas por coma", () => {
    expect(buildIlikeOrFilter("reunión", ["title", "text"])).toBe(
      'title.ilike."%reunión%",text.ilike."%reunión%"'
    );
  });

  it("escapa comillas dobles embebidas en la query (no rompe el value quoteado)", () => {
    const result = buildIlikeOrFilter('dice "hola"', ["title"]);
    expect(result).toBe('title.ilike."%dice \\"hola\\"%"');
  });

  it("escapa backslashes ANTES que comillas (no deja un escape a medio armar)", () => {
    const result = buildIlikeOrFilter("a\\b", ["title"]);
    expect(result).toBe('title.ilike."%a\\\\b%"');
  });

  it("una query que intenta cerrar el value con comillas + coma queda escapada por completo — no " +
    "puede inyectar una condición extra en el .or()", () => {
    // Sin el escape, esto rompería el quoting e inyectaría `user_id.neq."x` como condición nueva.
    const malicious = 'x",user_id.neq."x';
    const result = buildIlikeOrFilter(malicious, ["title"]);
    // El '_' de "user_id" también queda escapado (es wildcard de ILIKE) — no afecta el argumento de
    // esta prueba (que el quoting no se rompe), solo cambia el string literal esperado.
    expect(result).toBe('title.ilike."%x\\",user\\_id.neq.\\"x%"');
    // Todo el payload queda DENTRO de un único value quoteado: solo dos comillas dobles sin escapar
    // en TODO el string (la de apertura y la de cierre del value), ambas puestas por esta función,
    // no por la query maliciosa.
    const unescapedQuotes = result.match(/(?<!\\)"/g) ?? [];
    expect(unescapedQuotes).toHaveLength(2);
  });

  it("devuelve '' para una lista de columnas vacía", () => {
    expect(buildIlikeOrFilter("reunión", [])).toBe("");
  });

  it("escapa los wildcards de ILIKE ('%'/'_') — un '%' literal en la query matchea a sí mismo, no a un comodín", () => {
    const result = buildIlikeOrFilter("50% listo_ya", ["title"]);
    expect(result).toBe('title.ilike."%50\\% listo\\_ya%"');
  });
});
