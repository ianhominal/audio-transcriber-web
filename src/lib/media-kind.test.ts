import { describe, it, expect } from "vitest";
import { resolveMediaKind } from "./media-kind";

/**
 * `/api/transcribe` accepts video containers on purpose — Whisper pulls the audio track out of
 * them (see `src/lib/transcribe/accept.ts`). But the detail page rendered every result in an
 * `<audio>` element, and an `<audio>` fed a video container is at the mercy of the browser: some
 * play the audio track, some load nothing at all. A tester hit the second case and reported that
 * "el botón de reproducir no funciona con videos".
 */
describe("resolveMediaKind", () => {
  it("trata los contenedores de video como video", () => {
    expect(resolveMediaKind("reunion.mp4")).toBe("video");
    expect(resolveMediaKind("clase.MP4")).toBe("video");
    expect(resolveMediaKind("captura.mov")).toBe("video");
    expect(resolveMediaKind("charla.mkv")).toBe("video");
  });

  it("trata el audio como audio", () => {
    expect(resolveMediaKind("nota.mp3")).toBe("audio");
    expect(resolveMediaKind("nota.m4a")).toBe("audio");
    expect(resolveMediaKind("nota.wav")).toBe("audio");
    expect(resolveMediaKind("nota.opus")).toBe("audio");
    expect(resolveMediaKind("nota.flac")).toBe("audio");
  });

  // `.webm` is both: MediaRecorder writes audio-only webm, and a screen capture writes video webm.
  // `<video>` plays both, so it is the safe pick — an audio-only file just renders without picture.
  it("manda .webm a video, que reproduce las dos cosas", () => {
    expect(resolveMediaKind("grabacion.webm")).toBe("video");
  });

  it("prefiere el mime type cuando viene, por encima de la extensión", () => {
    expect(resolveMediaKind("archivo-sin-extension", "video/mp4")).toBe("video");
    expect(resolveMediaKind("cosa.mp4", "audio/mpeg")).toBe("audio");
  });

  it("cae en audio cuando no hay con qué decidir", () => {
    expect(resolveMediaKind("")).toBe("audio");
    expect(resolveMediaKind(null)).toBe("audio");
    expect(resolveMediaKind(undefined)).toBe("audio");
    expect(resolveMediaKind("archivo_sin_punto")).toBe("audio");
  });

  it("no se confunde con puntos en el medio del nombre", () => {
    expect(resolveMediaKind("reunion.2026.07.30.mp4")).toBe("video");
    expect(resolveMediaKind("nota.v2.mp3")).toBe("audio");
  });

  it("ignora los parámetros de una URL firmada", () => {
    expect(resolveMediaKind("audios/u1/reunion.mp4?token=abc&expires=123")).toBe("video");
  });
});
