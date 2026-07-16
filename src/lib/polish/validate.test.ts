import { describe, expect, it } from "vitest";
import { isTooShortToPolish, judgePolished, looksLikeMetaResponse, MIN_POLISH_CHARS } from "./validate";

describe("casos REALES de alucinación (2026-07-15)", () => {
  /// El modelo inventó una plantilla del Madrid (Benzema, Modrić, Kroos) que no está en el audio
  /// — y que además no existe hace años. Salió de su entrenamiento, no de la grabación.
  it("descarta la invención de la plantilla del Madrid", () => {
    const original = "Y el Madrid tiene a los jugadores del mundo en plantilla, a Vinicius Junior.";
    const hallucinated =
      "El Madrid tiene a los jugadores del mundo en plantilla, incluyendo a Vinicius Junior. " +
      "El equipo es muy fuerte, con nombres como Karim Benzema, Luka Modrić y Toni Kroos, entre otros. " +
      "Vinicius Junior es uno de los jugadores más jóvenes y prometedores del equipo, conocido por su " +
      "velocidad y habilidad en el campo de juego.";

    expect(judgePolished(original, hallucinated)).toEqual({ use: "original", reason: "too-long" });
  });

  /// "Qué duro, loco." (2 segundos) se convirtió en un monólogo entero.
  it("ni siquiera manda al modelo un turno de dos segundos", () => {
    expect(isTooShortToPolish("Qué duro, loco.")).toBe(true);
  });

  /// El modelo respondiéndole al usuario, pegado adentro de la transcripción.
  it("descarta al modelo hablándole al usuario", () => {
    const meta =
      "Me parece que no hay texto proporcionado. Por favor, proporciona el texto del usuario para " +
      "que pueda reescribirlo con puntuación y separarlo en párrafos.";

    expect(looksLikeMetaResponse(meta)).toBe(true);
    expect(judgePolished("algo que el usuario dijo en la reunión de ayer", meta)).toEqual({
      use: "original",
      reason: "meta-response",
    });
  });
});

describe("judgePolished", () => {
  const original = "hola que tal como estas che todo bien por ahi contame que anda pasando";

  it("acepta un pulido normal (crece un poco por la puntuación)", () => {
    const polished = "Hola, ¿qué tal? ¿Cómo estás, che? Todo bien por ahí. Contame, ¿qué anda pasando?";

    expect(judgePolished(original, polished)).toEqual({ use: "polished" });
  });

  it("acepta que quede exactamente igual", () => {
    expect(judgePolished(original, original)).toEqual({ use: "polished" });
  });

  it("descarta si se comió texto", () => {
    expect(judgePolished(original, "Hola.")).toEqual({ use: "original", reason: "too-short" });
  });

  it("descarta una respuesta vacía", () => {
    expect(judgePolished(original, "   ")).toEqual({ use: "original", reason: "empty" });
  });

  it("ante la duda gana el original: nunca devuelve 'polished' por defecto", () => {
    // Cualquier salida sospechosa cae a original; el único camino a "polished" es pasar TODO.
    const suspicious = ["", "   ", "x", "y".repeat(10_000), "Aquí está el texto: hola"];
    for (const s of suspicious) {
      expect(judgePolished(original, s).use, `falló con: ${s.slice(0, 20)}`).toBe("original");
    }
  });
});

describe("isTooShortToPolish", () => {
  it("deja pasar un texto con contenido real", () => {
    expect(isTooShortToPolish("a".repeat(MIN_POLISH_CHARS))).toBe(false);
  });

  it("frena fragmentos mínimos, que son comunes al pulir por turno", () => {
    for (const t of ["", "  ", "Amén.", "Sí.", "Qué duro, loco.", "Pero, pero, o sea."]) {
      expect(isTooShortToPolish(t), `deberia frenar: ${t}`).toBe(true);
    }
  });
});

describe("looksLikeMetaResponse", () => {
  it("no confunde texto real que hable de proporcionar cosas", () => {
    expect(looksLikeMetaResponse("Le dije que iba a proporcionar los datos mañana.")).toBe(false);
  });

  it("detecta las variantes conocidas", () => {
    expect(looksLikeMetaResponse("Como modelo de lenguaje, no puedo...")).toBe(true);
    expect(looksLikeMetaResponse("Aquí tienes el texto corregido:")).toBe(true);
  });
});
