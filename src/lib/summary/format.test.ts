import { describe, it, expect } from "vitest";
import { parseModelSummaryResponse, parseStoredSummary, serializeSummary } from "./format";

describe("parseModelSummaryResponse", () => {
  it("parsea un JSON válido con las 3 claves", () => {
    const raw = JSON.stringify({
      summary: "Resumen breve.",
      keyPoints: ["Punto 1", "Punto 2"],
      actionItems: ["Tarea 1"],
    });
    expect(parseModelSummaryResponse(raw)).toEqual({
      summary: "Resumen breve.",
      keyPoints: ["Punto 1", "Punto 2"],
      actionItems: ["Tarea 1"],
    });
  });

  it("pela un fence de Markdown ```json ... ``` antes de parsear", () => {
    const raw = '```json\n{"summary": "Resumen.", "keyPoints": [], "actionItems": []}\n```';
    expect(parseModelSummaryResponse(raw)).toEqual({ summary: "Resumen.", keyPoints: [], actionItems: [] });
  });

  it("pela un fence sin la palabra json", () => {
    const raw = '```\n{"summary": "Resumen.", "keyPoints": [], "actionItems": []}\n```';
    expect(parseModelSummaryResponse(raw)).toEqual({ summary: "Resumen.", keyPoints: [], actionItems: [] });
  });

  it("devuelve null ante JSON inválido", () => {
    expect(parseModelSummaryResponse("esto no es JSON")).toBeNull();
  });

  it("devuelve null si falta 'summary' o está vacío", () => {
    expect(parseModelSummaryResponse(JSON.stringify({ keyPoints: [], actionItems: [] }))).toBeNull();
    expect(parseModelSummaryResponse(JSON.stringify({ summary: "  ", keyPoints: [], actionItems: [] }))).toBeNull();
  });

  it("tolera keyPoints/actionItems ausentes — caen a array vacío", () => {
    expect(parseModelSummaryResponse(JSON.stringify({ summary: "Resumen." }))).toEqual({
      summary: "Resumen.",
      keyPoints: [],
      actionItems: [],
    });
  });

  it("filtra elementos no-string y recorta a 12 items por lista", () => {
    const raw = JSON.stringify({
      summary: "Resumen.",
      keyPoints: [...Array(15).fill("punto"), 42, null],
      actionItems: [],
    });
    const result = parseModelSummaryResponse(raw);
    expect(result?.keyPoints).toHaveLength(12);
    expect(result?.keyPoints.every((p) => p === "punto")).toBe(true);
  });

  it("descarta strings vacíos/solo-espacios de las listas", () => {
    const raw = JSON.stringify({ summary: "Resumen.", keyPoints: ["  ", "real", ""], actionItems: [] });
    expect(parseModelSummaryResponse(raw)?.keyPoints).toEqual(["real"]);
  });

  it("recorta el resumen y los items gigantes a su tope de largo", () => {
    const raw = JSON.stringify({
      summary: "s".repeat(5000),
      keyPoints: ["k".repeat(2000)],
      actionItems: ["a".repeat(2000)],
    });
    const result = parseModelSummaryResponse(raw);
    expect(result?.summary.length).toBe(2000);
    expect(result?.keyPoints[0].length).toBe(500);
    expect(result?.actionItems[0].length).toBe(500);
  });
});

describe("serializeSummary / parseStoredSummary", () => {
  it("hace roundtrip sin pérdida", () => {
    const summary = { summary: "Resumen.", keyPoints: ["a"], actionItems: ["b"] };
    expect(parseStoredSummary(serializeSummary(summary))).toEqual(summary);
  });

  it("devuelve null ante null/undefined/string vacío", () => {
    expect(parseStoredSummary(null)).toBeNull();
    expect(parseStoredSummary(undefined)).toBeNull();
    expect(parseStoredSummary("")).toBeNull();
  });

  it("devuelve null ante contenido corrupto", () => {
    expect(parseStoredSummary("{not json")).toBeNull();
  });
});
