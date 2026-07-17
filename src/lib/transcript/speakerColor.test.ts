import { describe, expect, it } from "vitest";
import { assignSpeakerColors } from "./speakerColor";

describe("assignSpeakerColors", () => {
  it("da un color distinto a cada hablante, en orden de aparición", () => {
    const map = assignSpeakerColors(["Persona 1", "Persona 2", "Persona 3"]);
    const colors = new Set([map.get("Persona 1"), map.get("Persona 2"), map.get("Persona 3")]);
    expect(colors.size).toBe(3); // tres colores distintos
  });

  it("es estable: la misma etiqueta siempre recibe el mismo color", () => {
    // Orden real de un texto: Persona 1 habla, Persona 2 responde, Persona 1 vuelve a hablar.
    const map = assignSpeakerColors(["Persona 1", "Persona 2", "Persona 1", "Persona 2", "Persona 1"]);
    expect(map.size).toBe(2);
    expect(map.get("Persona 1")).toBe("text-indigo-600 dark:text-indigo-400");
    expect(map.get("Persona 2")).toBe("text-teal-600 dark:text-teal-400");
  });

  it("manda 'Sin identificar' a un neutro y no le gasta un color de la paleta", () => {
    // "Sin identificar" aparece PRIMERO, pero no debe robarle el indigo a Persona 1.
    const map = assignSpeakerColors(["Sin identificar", "Persona 1", "Persona 2"]);
    expect(map.get("Sin identificar")).toBe("text-tertiary");
    expect(map.get("Persona 1")).toBe("text-indigo-600 dark:text-indigo-400");
    expect(map.get("Persona 2")).toBe("text-teal-600 dark:text-teal-400");
  });

  it("cicla la paleta cuando hay más hablantes que colores", () => {
    const labels = Array.from({ length: 7 }, (_, i) => `Persona ${i + 1}`);
    const map = assignSpeakerColors(labels);
    // 6 colores en la paleta → el séptimo reusa el primero.
    expect(map.get("Persona 7")).toBe(map.get("Persona 1"));
    expect(map.get("Persona 6")).not.toBe(map.get("Persona 1"));
  });

  it("con lista vacía devuelve un mapa vacío", () => {
    expect(assignSpeakerColors([]).size).toBe(0);
  });
});
