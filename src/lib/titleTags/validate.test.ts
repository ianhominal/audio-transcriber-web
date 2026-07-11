import { describe, it, expect } from "vitest";
import { canGenerateTitleTags, isPlaceholderTitle, MIN_TITLE_TAGS_TEXT_LENGTH } from "./validate";

describe("canGenerateTitleTags", () => {
  it("false para texto vacío o muy corto", () => {
    expect(canGenerateTitleTags("")).toBe(false);
    expect(canGenerateTitleTags("   ")).toBe(false);
    expect(canGenerateTitleTags("hola")).toBe(false);
  });

  it("true apenas se alcanza el mínimo", () => {
    expect(canGenerateTitleTags("a".repeat(MIN_TITLE_TAGS_TEXT_LENGTH))).toBe(true);
  });

  it("false justo un caracter por debajo del mínimo", () => {
    expect(canGenerateTitleTags("a".repeat(MIN_TITLE_TAGS_TEXT_LENGTH - 1))).toBe(false);
  });

  it("true para un texto normal", () => {
    expect(canGenerateTitleTags("Hoy hablamos de la reunión de planificación del proyecto.")).toBe(true);
  });
});

describe("isPlaceholderTitle", () => {
  it("true si el título es vacío", () => {
    expect(isPlaceholderTitle("", "audio.mp3")).toBe(true);
    expect(isPlaceholderTitle("   ", "audio.mp3")).toBe(true);
  });

  it("true si el título coincide con el nombre de archivo completo (subida sin editar)", () => {
    expect(isPlaceholderTitle("reunion-importante.mp3", "reunion-importante.mp3")).toBe(true);
  });

  it("true si el título coincide con el nombre de archivo SIN extensión", () => {
    expect(isPlaceholderTitle("reunion-importante", "reunion-importante.mp3")).toBe(true);
  });

  it("true para el patrón mecánico de grabación/captura (Grabacion-<timestamp> / Reunion-<timestamp>)", () => {
    expect(isPlaceholderTitle("Grabacion-1720368000000", "Grabacion-1720368000000.webm")).toBe(true);
    expect(isPlaceholderTitle("Reunion-1720368000000", "Reunion-1720368000000.webm")).toBe(true);
  });

  it("false para un título que la usuaria escribió a mano", () => {
    expect(isPlaceholderTitle("Charla con el equipo de ventas", "audio.mp3")).toBe(false);
    expect(isPlaceholderTitle("Ideas para el cumpleaños de Lu", "Grabacion-1720368000000.webm")).toBe(false);
  });

  it("no confunde un título parecido pero no exacto al patrón mecánico", () => {
    expect(isPlaceholderTitle("Grabacion importante", "audio.mp3")).toBe(false);
    expect(isPlaceholderTitle("Reunion-abc", "audio.mp3")).toBe(false);
  });
});
