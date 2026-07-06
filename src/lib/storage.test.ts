import { describe, it, expect } from "vitest";
import { audioExtension, buildAudioObjectPath } from "./storage";

describe("audioExtension", () => {
  it("devuelve la extensión en minúsculas con punto", () => {
    expect(audioExtension("nota.OGG")).toBe(".ogg");
    expect(audioExtension("a.b.mp3")).toBe(".mp3");
    expect(audioExtension("voz.m4a")).toBe(".m4a");
  });

  it("devuelve cadena vacía si no hay extensión", () => {
    expect(audioExtension("audio")).toBe("");
    expect(audioExtension("")).toBe("");
    expect(audioExtension("sin-punto-final.")).toBe("");
  });
});

describe("buildAudioObjectPath", () => {
  it("arma el path como userId/objectId+ext (aísla por usuario para la RLS)", () => {
    expect(buildAudioObjectPath("user-1", "obj-9", ".ogg")).toBe("user-1/obj-9.ogg");
  });

  it("funciona sin extensión", () => {
    expect(buildAudioObjectPath("user-1", "obj-9", "")).toBe("user-1/obj-9");
  });
});
