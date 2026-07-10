import { describe, it, expect } from "vitest";
import { hashSummarySource } from "./hash";

describe("hashSummarySource", () => {
  it("es determinístico para el mismo texto", () => {
    expect(hashSummarySource("hola mundo")).toBe(hashSummarySource("hola mundo"));
  });

  it("da un hash distinto ante un texto distinto", () => {
    expect(hashSummarySource("hola mundo")).not.toBe(hashSummarySource("hola mundo!"));
  });

  it("ignora espacios al principio/final (mismo criterio que canSummarizeText)", () => {
    expect(hashSummarySource("  hola mundo  ")).toBe(hashSummarySource("hola mundo"));
  });

  it("devuelve un hex de 64 caracteres (sha256)", () => {
    expect(hashSummarySource("texto")).toMatch(/^[0-9a-f]{64}$/);
  });
});
