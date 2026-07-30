import { describe, it, expect, afterEach, vi } from "vitest";
import { AUDIO_MIME_CANDIDATES, pickSupportedMimeType, extensionForMimeType, WEB_MAX_BYTES } from "./recording";

describe("pickSupportedMimeType", () => {
  afterEach(() => {
    // @ts-expect-error -- MediaRecorder no existe en el entorno "node" de Vitest; lo stubbeamos por test.
    delete globalThis.MediaRecorder;
  });

  it("devuelve undefined si MediaRecorder no existe en este entorno (SSR/navegador viejo)", () => {
    expect(pickSupportedMimeType(AUDIO_MIME_CANDIDATES)).toBeUndefined();
  });

  it("devuelve undefined si MediaRecorder existe pero no expone isTypeSupported", () => {
    // @ts-expect-error -- stub mínimo, no necesitamos la clase completa para este test.
    globalThis.MediaRecorder = {};
    expect(pickSupportedMimeType(AUDIO_MIME_CANDIDATES)).toBeUndefined();
  });

  it("elige el primer candidato soportado, en orden de preferencia", () => {
    // @ts-expect-error -- stub mínimo.
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn((type: string) => type === "audio/ogg"),
    };
    expect(pickSupportedMimeType(AUDIO_MIME_CANDIDATES)).toBe("audio/ogg");
  });

  it("usa AUDIO_MIME_CANDIDATES como default si no se pasan candidatos", () => {
    // @ts-expect-error -- stub mínimo.
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn((type: string) => type === "audio/webm;codecs=opus"),
    };
    expect(pickSupportedMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("devuelve undefined si ningún candidato está soportado", () => {
    // @ts-expect-error -- stub mínimo.
    globalThis.MediaRecorder = { isTypeSupported: vi.fn(() => false) };
    expect(pickSupportedMimeType(AUDIO_MIME_CANDIDATES)).toBeUndefined();
  });
});

describe("extensionForMimeType", () => {
  it("devuelve 'ogg' para mimeTypes que contienen ogg", () => {
    expect(extensionForMimeType("audio/ogg")).toBe("ogg");
    expect(extensionForMimeType("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("devuelve 'webm' para cualquier otro mimeType (webm y fallback)", () => {
    expect(extensionForMimeType("audio/webm")).toBe("webm");
    expect(extensionForMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMimeType("audio/webm")).toBe("webm");
  });
});

describe("WEB_MAX_BYTES", () => {
  // Regression: el límite de Vercel es 4,5 MB DECIMAL. Cuando esta constante valía 4,5 MiB
  // (4_718_592) una grabación en esa franja pasaba el chequeo del cliente y la plataforma la
  // rechazaba en el borde con texto plano, sin llegar nunca al handler — se perdió un audio real.
  it("queda por debajo del límite de payload de Vercel (4,5 MB decimales)", () => {
    expect(WEB_MAX_BYTES).toBeLessThan(4_500_000);
  });

  it("deja margen para el overhead del multipart, no se pega al límite", () => {
    expect(4_500_000 - WEB_MAX_BYTES).toBeGreaterThanOrEqual(50_000);
  });

  it("sigue siendo un tope útil, no uno tan bajo que rechace grabaciones normales", () => {
    expect(WEB_MAX_BYTES).toBeGreaterThan(4_000_000);
  });
});
