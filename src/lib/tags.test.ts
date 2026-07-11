import { describe, it, expect } from "vitest";
import { normalizeTag, sanitizeTags, normalizeTagFilter, MAX_TAGS, MAX_TAG_LENGTH } from "./tags";

describe("normalizeTag", () => {
  it("trimea y pasa a minúscula", () => {
    expect(normalizeTag("  Reunión de Equipo  ")).toBe("reunión de equipo");
  });

  it("devuelve null para no-strings, vacío o solo espacios", () => {
    expect(normalizeTag(42)).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("capa el largo a MAX_TAG_LENGTH", () => {
    const long = "a".repeat(MAX_TAG_LENGTH + 20);
    expect(normalizeTag(long)?.length).toBe(MAX_TAG_LENGTH);
  });
});

describe("sanitizeTags", () => {
  it("normaliza cada tag y descarta inválidos", () => {
    expect(sanitizeTags(["Finanzas", "  ", 42, null, "Trabajo"])).toEqual(["finanzas", "trabajo"]);
  });

  it("deduplica tags que normalizan al mismo valor", () => {
    expect(sanitizeTags(["Reunión", "reunión", " REUNIÓN "])).toEqual(["reunión"]);
  });

  it("capa a MAX_TAGS", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`);
    expect(sanitizeTags(many)).toHaveLength(MAX_TAGS);
  });

  it("no exige un mínimo — acepta menos de 3 tags", () => {
    expect(sanitizeTags(["solo-uno"])).toEqual(["solo-uno"]);
  });

  it("devuelve [] si no es un array, sin lanzar", () => {
    expect(sanitizeTags(null)).toEqual([]);
    expect(sanitizeTags("no es array")).toEqual([]);
    expect(sanitizeTags(undefined)).toEqual([]);
  });
});

describe("normalizeTagFilter", () => {
  it("normaliza igual que normalizeTag (mismo criterio que el guardado)", () => {
    expect(normalizeTagFilter("Reunión ")).toBe("reunión");
  });

  it("devuelve null para ausente/vacío", () => {
    expect(normalizeTagFilter(null)).toBeNull();
    expect(normalizeTagFilter(undefined)).toBeNull();
    expect(normalizeTagFilter("")).toBeNull();
    expect(normalizeTagFilter("   ")).toBeNull();
  });
});
