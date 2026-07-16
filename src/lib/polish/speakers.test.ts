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

  it("un párrafo sin etiqueta DESPUÉS de un turno es continuación de ese hablante", () => {
    // El propio pulido agrega cortes de párrafo adentro de un turno largo, y esos párrafos nuevos
    // no llevan etiqueta. Antes esto devolvía null y un segundo pulido borraba las etiquetas.
    const blocks = splitSpeakerBlocks("Persona 1: hola\n\nsigo hablando yo");

    expect(blocks).toHaveLength(1);
    expect(blocks![0]).toEqual({ label: "Persona 1", text: "hola\n\nsigo hablando yo" });
  });

  it("devuelve null si el texto arranca SIN etiqueta (no es diarizado)", () => {
    expect(splitSpeakerBlocks("texto suelto\n\nPersona 1: hola")).toBeNull();
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

  /// Salida REAL del pulido (2026-07-16): el modelo partió un turno largo en tres párrafos. Un
  /// segundo "Mejorar texto" tiene que seguir viendo los turnos, no tratar todo como texto suelto.
  it("un texto YA pulido se puede volver a pulir sin perder las etiquetas", () => {
    const yaPulido = `Persona 1: Pero entiéndanme, me hicieron tantas bromas. Adiós.

Ustedes saben que yo tengo buena relación con Vinicius Junior.

Porque la última vez que nos vimos, fue acá en Argentina.

Persona 3: Qué duro, loco.

Sin identificar: Amén.`;

    const blocks = splitSpeakerBlocks(yaPulido);

    expect(blocks).not.toBeNull();
    expect(blocks!.map((b) => b.label)).toEqual(["Persona 1", "Persona 3", "Sin identificar"]);
    // Los dos párrafos huérfanos quedaron adentro del turno de Persona 1, donde corresponden.
    expect(blocks![0].text).toContain("Vinicius Junior");
    expect(blocks![0].text).toContain("Argentina");
    // Y rearmarlo devuelve exactamente lo mismo: pulir dos veces no degrada nada.
    expect(joinSpeakerBlocks(blocks!)).toBe(yaPulido);
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
