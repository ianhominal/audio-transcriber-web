import { describe, it, expect } from "vitest";
import { dedupeSatisfiesRequest } from "./dedupe";

describe("dedupeSatisfiesRequest", () => {
  describe("flujo: translate → después transcribe el mismo archivo (bugfix MEDIUM #1)", () => {
    it("un request 'transcribir' sobre una copia YA TRADUCIDA no se satisface — hay que reprocesar", () => {
      // La fila más reciente es una traducción al inglés; el usuario ahora pide "Transcribir" tal
      // cual (mode !== "translate"). Antes del fix esto daba `true` (bug: devolvía el texto
      // traducido como si fuera la transcripción original).
      expect(dedupeSatisfiesRequest("transcribe", "en", "en")).toBe(false);
      expect(dedupeSatisfiesRequest("transcribe", "en", "es")).toBe(false);
    });

    it("un request 'transcribir' sobre una copia SIN traducir sí se satisface (dedupe normal)", () => {
      expect(dedupeSatisfiesRequest("transcribe", null, "en")).toBe(true);
    });
  });

  describe("flujo: transcribe → después translate el mismo archivo (comportamiento pre-existente, sin cambios)", () => {
    it("un request 'traducir' se satisface solo si la copia ya está traducida al MISMO idioma destino", () => {
      expect(dedupeSatisfiesRequest("translate", "en", "en")).toBe(true);
    });

    it("un request 'traducir' NO se satisface si la copia está traducida a OTRO idioma", () => {
      expect(dedupeSatisfiesRequest("translate", "en", "pt")).toBe(false);
    });

    it("un request 'traducir' NO se satisface si la copia existente todavía no está traducida", () => {
      expect(dedupeSatisfiesRequest("translate", null, "en")).toBe(false);
    });
  });
});
