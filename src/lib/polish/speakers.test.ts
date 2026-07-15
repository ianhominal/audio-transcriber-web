import { describe, expect, it } from "vitest";
import { joinSpeakerBlocks, splitSpeakerBlocks } from "./speakers";

/** Fragmento real de una transcripción diarizada por el desktop. */
const REAL = `Persona 1: Le voy a decir que si me ganan en un quiz de fútbol conocerán a Vinicius Junior.

Persona 3: Qué duro, loco.

Persona 1: Es literalmente Vinicius Jr., hermano.

Sin identificar: Amén.`;

describe("splitSpeakerBlocks", () => {
  it("parte una transcripción real en sus turnos", () => {
    const blocks = splitSpeakerBlocks(REAL);

    expect(blocks).toHaveLength(4);
    expect(blocks![0].label).toBe("Persona 1");
    expect(blocks![1]).toEqual({ label: "Persona 3", text: "Qué duro, loco." });
    expect(blocks![3]).toEqual({ label: "Sin identificar", text: "Amén." });
  });

  it("la etiqueta NO queda dentro del texto que se le manda al modelo", () => {
    const blocks = splitSpeakerBlocks(REAL);

    for (const b of blocks!) {
      expect(b.text).not.toContain("Persona ");
      expect(b.text).not.toContain("Sin identificar");
    }
  });

  it("devuelve null cuando el texto NO tiene hablantes (nota normal)", () => {
    expect(splitSpeakerBlocks("Esto es una nota cualquiera.\n\nCon dos párrafos.")).toBeNull();
  });

  it("devuelve null si hay texto suelto mezclado con turnos", () => {
    // Mezclar etiquetado con suelto haría que el suelto pierda su lugar al rearmar.
    expect(splitSpeakerBlocks("Persona 1: hola\n\ntexto suelto sin etiqueta")).toBeNull();
  });

  it("no abre un turno si el nombre aparece MENCIONADO en el medio de una frase", () => {
    const blocks = splitSpeakerBlocks("Persona 1: le dije a la Persona 2: que viniera");

    expect(blocks).toHaveLength(1);
    expect(blocks![0].text).toBe("le dije a la Persona 2: que viniera");
  });

  it("tolera texto vacío", () => {
    expect(splitSpeakerBlocks("")).toBeNull();
    expect(splitSpeakerBlocks("   \n\n  ")).toBeNull();
  });

  it("acepta números de persona de más de un dígito", () => {
    const blocks = splitSpeakerBlocks("Persona 12: hola");

    expect(blocks![0].label).toBe("Persona 12");
  });
});

describe("joinSpeakerBlocks", () => {
  it("rearma con las etiquetas intactas", () => {
    const blocks = [
      { label: "Persona 1", text: "hola" },
      { label: "Persona 2", text: "chau" },
    ];

    expect(joinSpeakerBlocks(blocks)).toBe("Persona 1: hola\n\nPersona 2: chau");
  });

  it("descarta turnos que quedaron vacíos", () => {
    const blocks = [
      { label: "Persona 1", text: "hola" },
      { label: "Persona 2", text: "   " },
    ];

    expect(joinSpeakerBlocks(blocks)).toBe("Persona 1: hola");
  });
});

describe("ida y vuelta", () => {
  /// LA garantía: si el modelo devolviera el texto igual, el resultado tiene que ser idéntico.
  it("partir y rearmar sin tocar nada reconstruye la misma transcripción", () => {
    const blocks = splitSpeakerBlocks(REAL);

    expect(joinSpeakerBlocks(blocks!)).toBe(REAL);
  });

  it("las etiquetas sobreviven aunque el modelo reescriba TODO el texto", () => {
    const blocks = splitSpeakerBlocks(REAL)!;
    // Simula al modelo devolviendo cualquier cosa: las etiquetas no dependen de él.
    const polished = blocks.map((b) => ({ ...b, text: "TEXTO REESCRITO POR EL MODELO" }));
    const result = joinSpeakerBlocks(polished);

    expect(result).toContain("Persona 1: TEXTO REESCRITO");
    expect(result).toContain("Persona 3: TEXTO REESCRITO");
    expect(result).toContain("Sin identificar: TEXTO REESCRITO");
    expect(result.split("\n\n")).toHaveLength(4);
  });
});
