import { describe, it, expect } from "vitest";
import { formatFileSize, formatDuration, formatDate, validateProjectName } from "./format";

describe("formatFileSize", () => {
  it("muestra bytes cuando es menor a 1 KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("convierte a KB y MB con hasta 1 decimal", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1048576)).toBe("1 MB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });

  it("tolera valores inválidos", () => {
    expect(formatFileSize(-10)).toBe("0 B");
    expect(formatFileSize(NaN)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("formatea segundos como m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("tolera valores inválidos", () => {
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
  });
});

describe("formatDate", () => {
  it("devuelve una fecha legible para un ISO válido", () => {
    // 2026-07-06T15:40:44Z → contiene el año
    expect(formatDate("2026-07-06T15:40:44Z")).toContain("2026");
  });

  it("devuelve cadena vacía si el ISO es inválido", () => {
    expect(formatDate("no-es-fecha")).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("validateProjectName", () => {
  it("rechaza vacíos o solo espacios", () => {
    expect(validateProjectName("")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
    expect(validateProjectName("   ")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
  });

  it("recorta espacios y acepta nombres válidos", () => {
    expect(validateProjectName("  Trabajo  ")).toEqual({ ok: true, value: "Trabajo" });
  });

  it("rechaza nombres demasiado largos (>60)", () => {
    const largo = "a".repeat(61);
    expect(validateProjectName(largo)).toEqual({
      ok: false,
      error: "El nombre no puede superar los 60 caracteres.",
    });
  });
});
