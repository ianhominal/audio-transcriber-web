import { describe, it, expect } from "vitest";
import { chooseUploadRoute, TRANSCRIBE_MAX_BYTES, storageExtensionFor } from "./route";
import { WEB_MAX_BYTES } from "@/lib/recording";

/**
 * Vercel corta el body de una función serverless en ~4,5 MB, así que un audio más grande nunca
 * llegaba al handler. Pero el camino para saltear eso YA EXISTE desde que el desktop sube
 * reuniones largas: `/api/audio/prepare` da un signed upload URL, el archivo va DIRECTO a Supabase
 * Storage, y `/api/transcribe` lo transcribe desde ahí con `storagePath`. La web no lo usaba.
 *
 * Con eso el techo real pasa a ser el de Groq (25 MB), no el de Vercel.
 */
describe("chooseUploadRoute", () => {
  it("manda los archivos chicos por el body, que es un solo request", () => {
    expect(chooseUploadRoute(1)).toBe("body");
    expect(chooseUploadRoute(WEB_MAX_BYTES)).toBe("body");
  });

  it("manda por Storage lo que no entra en el body de Vercel", () => {
    expect(chooseUploadRoute(WEB_MAX_BYTES + 1)).toBe("storage");
    expect(chooseUploadRoute(20 * 1024 * 1024)).toBe("storage");
    expect(chooseUploadRoute(TRANSCRIBE_MAX_BYTES)).toBe("storage");
  });

  // Groq rechaza por encima de 25 MB, así que subirlo a Storage sería gastar transferencia para
  // que falle después. Se corta antes, del lado del cliente.
  it("rechaza lo que Groq no va a aceptar igual", () => {
    expect(chooseUploadRoute(TRANSCRIBE_MAX_BYTES + 1)).toBe("too-large");
  });

  it("el techo nuevo es varias veces el viejo", () => {
    expect(TRANSCRIBE_MAX_BYTES).toBeGreaterThan(WEB_MAX_BYTES * 4);
  });

  it("tolera tamaños inválidos sin romper", () => {
    expect(chooseUploadRoute(0)).toBe("body");
    expect(chooseUploadRoute(-1)).toBe("body");
    expect(chooseUploadRoute(Number.NaN)).toBe("too-large");
  });
});

describe("storageExtensionFor", () => {
  it("saca la extensión con punto, como la espera /api/audio/prepare", () => {
    expect(storageExtensionFor("Grabacion-123.webm")).toBe(".webm");
    expect(storageExtensionFor("nota de voz.m4a")).toBe(".m4a");
  });

  it("normaliza a minúsculas", () => {
    expect(storageExtensionFor("REUNION.M4A")).toBe(".m4a");
  });

  it("no se confunde con puntos en el medio del nombre", () => {
    expect(storageExtensionFor("reunion.2026.07.30.mp4")).toBe(".mp4");
  });

  // Sin extensión usable no se puede pedir el signed URL: la allowlist del server la exige.
  it("devuelve null cuando no hay extensión utilizable", () => {
    expect(storageExtensionFor("archivo_sin_punto")).toBeNull();
    expect(storageExtensionFor("")).toBeNull();
    expect(storageExtensionFor("raro.")).toBeNull();
  });
});
