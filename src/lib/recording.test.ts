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
  it("es ~4.5 MB, el límite de payload de Vercel", () => {
    expect(WEB_MAX_BYTES).toBe(Math.floor(4.5 * 1024 * 1024));
  });
});
