import { describe, it, expect } from "vitest";
import { parseModelTitleTagsResponse } from "./format";

describe("parseModelTitleTagsResponse", () => {
  it("parsea un JSON válido con título y tags", () => {
    const raw = JSON.stringify({
      title: "Reunión de planificación semanal",
      tags: ["reunión", "planificación", "equipo"],
    });
    expect(parseModelTitleTagsResponse(raw)).toEqual({
      title: "Reunión de planificación semanal",
      tags: ["reunión", "planificación", "equipo"],
    });
  });

  it("pela un bloque de código Markdown (```json ... ```) alrededor del JSON", () => {
    const raw = "```json\n" + JSON.stringify({ title: "Título", tags: ["a"] }) + "\n```";
    expect(parseModelTitleTagsResponse(raw)).toEqual({ title: "Título", tags: ["a"] });
  });

  it("devuelve null si no es JSON parseable", () => {
    expect(parseModelTitleTagsResponse("esto no es JSON")).toBeNull();
  });

  it("devuelve null si falta 'title' o queda vacío después del trim", () => {
    expect(parseModelTitleTagsResponse(JSON.stringify({ tags: ["a"] }))).toBeNull();
    expect(parseModelTitleTagsResponse(JSON.stringify({ title: "   ", tags: ["a"] }))).toBeNull();
    expect(parseModelTitleTagsResponse(JSON.stringify({ title: 42, tags: ["a"] }))).toBeNull();
  });

  it("normaliza tags (minúscula, dedupe, cap) reusando sanitizeTags", () => {
    const raw = JSON.stringify({ title: "Título", tags: ["Finanzas", "finanzas", "Trabajo"] });
    expect(parseModelTitleTagsResponse(raw)).toEqual({ title: "Título", tags: ["finanzas", "trabajo"] });
  });

  it("acepta tags ausente/inválido como lista vacía, sin invalidar el título", () => {
    expect(parseModelTitleTagsResponse(JSON.stringify({ title: "Título" }))).toEqual({
      title: "Título",
      tags: [],
    });
    expect(parseModelTitleTagsResponse(JSON.stringify({ title: "Título", tags: "no es array" }))).toEqual({
      title: "Título",
      tags: [],
    });
  });

  it("recorta el título a 120 caracteres (defensa ante un modelo que ignore el prompt)", () => {
    const longTitle = "a".repeat(200);
    const raw = JSON.stringify({ title: longTitle, tags: [] });
    expect(parseModelTitleTagsResponse(raw)?.title.length).toBe(120);
  });

  it("trimea el título", () => {
    expect(
      parseModelTitleTagsResponse(JSON.stringify({ title: "  Título con espacios  ", tags: [] }))?.title
    ).toBe("Título con espacios");
  });
});
