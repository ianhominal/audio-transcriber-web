import { describe, it, expect, afterEach } from "vitest";
import { readCachedDefaults, writeCachedDefaults } from "./local-cache";
import { DEFAULT_TRANSCRIPTION_SETTINGS } from "./user-settings";

/**
 * `local-cache.ts` hace `typeof window !== "undefined"` para decidir si hay `localStorage` real
 * (comportamiento client-only). El entorno de Vitest de este repo es `node` (ver
 * `vitest.config.ts`: "la UI y los flujos se testean con Playwright"), así que acá simulamos un
 * `window`/`localStorage` mínimos solo para poder ejercitar la rama de lectura/escritura real —
 * se restauran después de cada test para no filtrar estado entre archivos.
 */
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { localStorage: unknown }).localStorage = fakeStorage;
  return fakeStorage;
}

function uninstallFakeLocalStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

describe("readCachedDefaults / writeCachedDefaults", () => {
  afterEach(() => {
    uninstallFakeLocalStorage();
  });

  it("en el server (sin window) devuelve el default de fábrica", () => {
    expect(readCachedDefaults()).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
  });

  it("sin nada guardado todavía, devuelve el default de fábrica", () => {
    installFakeLocalStorage();
    expect(readCachedDefaults()).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
  });

  it("escribe y vuelve a leer el mismo valor", () => {
    installFakeLocalStorage();
    const value = { engine: "groq", quality: "whisper-large-v3", language: "en" };
    writeCachedDefaults(value);
    expect(readCachedDefaults()).toEqual(value);
  });

  it("lee la clave legada `transcribe:language` si el cache nuevo no existe todavía", () => {
    const storage = installFakeLocalStorage();
    storage.setItem("transcribe:language", "en");
    expect(readCachedDefaults()).toEqual({ ...DEFAULT_TRANSCRIPTION_SETTINGS, language: "en" });
  });

  it("escribir el cache nuevo limpia la clave legada", () => {
    const storage = installFakeLocalStorage();
    storage.setItem("transcribe:language", "en");
    writeCachedDefaults({ engine: "groq", quality: "whisper-large-v3-turbo", language: "es" });
    expect(storage.getItem("transcribe:language")).toBeNull();
  });

  it("un cache corrupto (JSON inválido) no rompe la lectura, cae al default", () => {
    const storage = installFakeLocalStorage();
    storage.setItem("transcribe:defaults", "{not-json");
    expect(readCachedDefaults()).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
  });
});
