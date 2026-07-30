import { describe, expect, it } from "vitest";
import { GROQ_MAX_AUDIO_BYTES, driveBatchProgressLabel, shouldStopBatch } from "./audio-import";

describe("GROQ_MAX_AUDIO_BYTES", () => {
  it("es exactamente 25 MiB, el tope de Groq espejado en toda la app", () => {
    // Mismo número que /api/transcribe y que EngineSelector.CloudMaxBytes en el desktop. Si Groq lo
    // cambia (el tier pago admite 100 MB), este test obliga a actualizar los tres lugares a la vez.
    expect(GROQ_MAX_AUDIO_BYTES).toBe(26_214_400);
  });
});

describe("driveBatchProgressLabel", () => {
  it("muestra el avance de la tanda", () => {
    expect(driveBatchProgressLabel(3, 14)).toBe("3 de 14");
  });

  it("no muestra nada cuando no hay audios que procesar", () => {
    expect(driveBatchProgressLabel(0, 0)).toBeNull();
    expect(driveBatchProgressLabel(5, 0)).toBeNull();
  });

  it("nunca informa más hechos que el total ni un negativo", () => {
    // Defensa ante un contador desincronizado: "15 de 14" o "-1 de 14" leen como un bug.
    expect(driveBatchProgressLabel(20, 14)).toBe("14 de 14");
    expect(driveBatchProgressLabel(-3, 14)).toBe("0 de 14");
  });
});

describe("shouldStopBatch", () => {
  it("corta la tanda al llegar al límite diario", () => {
    // Ninguno de los audios que siguen va a entrar: insistir solo genera errores idénticos.
    expect(shouldStopBatch(undefined, 429)).toBe(true);
  });

  it("corta la tanda si se cayó la sesión o la conexión con Drive", () => {
    expect(shouldStopBatch(undefined, 401)).toBe(true);
    expect(shouldStopBatch(undefined, 403)).toBe(true);
    expect(shouldStopBatch("not-connected", 400)).toBe(true);
    expect(shouldStopBatch("needs-reauth", 400)).toBe(true);
  });

  it("sigue con los demás cuando el problema es de UN audio puntual", () => {
    // Un archivo de más de 25 MB o en silencio no dice nada sobre los otros 13.
    expect(shouldStopBatch("too-large", 400)).toBe(false);
    expect(shouldStopBatch(undefined, 422)).toBe(false);
    expect(shouldStopBatch(undefined, 502)).toBe(false);
    expect(shouldStopBatch("drive-error", 502)).toBe(false);
  });
});
