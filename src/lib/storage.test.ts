import { describe, it, expect, vi } from "vitest";
import {
  audioExtension,
  buildAudioObjectPath,
  uploadWithRetry,
  UPLOAD_MAX_ATTEMPTS,
  isAllowedAudioExtension,
  isOwnedStoragePath,
  sanitizeAudioName,
} from "./storage";

// `sleep` fake que no espera de verdad — solo registra los delays pedidos, para que los tests
// corran instantáneo sin depender de los tiempos reales de backoff.
function fakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

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

describe("isAllowedAudioExtension", () => {
  it("acepta extensiones conocidas con el punto", () => {
    expect(isAllowedAudioExtension(".ogg")).toBe(true);
    expect(isAllowedAudioExtension(".opus")).toBe(true);
    expect(isAllowedAudioExtension(".wav")).toBe(true);
    expect(isAllowedAudioExtension(".mp3")).toBe(true);
    expect(isAllowedAudioExtension(".m4a")).toBe(true);
    expect(isAllowedAudioExtension(".webm")).toBe(true);
    expect(isAllowedAudioExtension(".aac")).toBe(true);
  });

  it("es case-insensitive", () => {
    expect(isAllowedAudioExtension(".OGG")).toBe(true);
    expect(isAllowedAudioExtension(".Mp3")).toBe(true);
  });

  it("rechaza extensiones desconocidas", () => {
    expect(isAllowedAudioExtension(".exe")).toBe(false);
    expect(isAllowedAudioExtension(".txt")).toBe(false);
  });

  it("rechaza formato inválido (sin punto, vacío, con path traversal)", () => {
    expect(isAllowedAudioExtension("ogg")).toBe(false);
    expect(isAllowedAudioExtension("")).toBe(false);
    expect(isAllowedAudioExtension(".")).toBe(false);
    expect(isAllowedAudioExtension("../ogg")).toBe(false);
    expect(isAllowedAudioExtension(".og g")).toBe(false);
  });

  it("rechaza valores no-string sin lanzar", () => {
    expect(isAllowedAudioExtension(undefined)).toBe(false);
    expect(isAllowedAudioExtension(null)).toBe(false);
    expect(isAllowedAudioExtension(123)).toBe(false);
    expect(isAllowedAudioExtension({})).toBe(false);
  });
});

describe("isOwnedStoragePath", () => {
  it("acepta un path cuyo primer segmento es el userId", () => {
    expect(isOwnedStoragePath("user-1/obj-9.ogg", "user-1")).toBe(true);
  });

  it("rechaza el path de otro usuario", () => {
    expect(isOwnedStoragePath("user-2/obj-9.ogg", "user-1")).toBe(false);
  });

  it("rechaza un userId que es prefijo de otro (sin falso positivo por el separador)", () => {
    expect(isOwnedStoragePath("user-12/obj-9.ogg", "user-1")).toBe(false);
  });

  it("rechaza valores no-string o vacíos sin lanzar", () => {
    expect(isOwnedStoragePath(undefined, "user-1")).toBe(false);
    expect(isOwnedStoragePath(null, "user-1")).toBe(false);
    expect(isOwnedStoragePath("", "user-1")).toBe(false);
    expect(isOwnedStoragePath("user-1/obj-9.ogg", "")).toBe(false);
  });
});

describe("sanitizeAudioName", () => {
  it("devuelve el nombre recortado si es un string no vacío", () => {
    expect(sanitizeAudioName("reunion.ogg")).toBe("reunion.ogg");
    expect(sanitizeAudioName("  reunion.ogg  ")).toBe("reunion.ogg");
  });

  it("devuelve null si queda vacío después del trim", () => {
    expect(sanitizeAudioName("")).toBeNull();
    expect(sanitizeAudioName("   ")).toBeNull();
  });

  it("devuelve null para valores no-string sin lanzar", () => {
    expect(sanitizeAudioName(undefined)).toBeNull();
    expect(sanitizeAudioName(null)).toBeNull();
    expect(sanitizeAudioName(123)).toBeNull();
  });
});

describe("uploadWithRetry", () => {
  it("no reintenta si el primer intento ya tiene éxito", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi.fn().mockResolvedValue({ error: null, data: { path: "x" } });

    const result = await uploadWithRetry(attempt, [300, 800], sleep);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ error: null, data: { path: "x" }, attempts: 1 });
  });

  it("reintenta ante error devuelto y corta al primer éxito", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "network", name: "StorageError" } })
      .mockResolvedValueOnce({ error: null, data: { path: "x" } });

    const result = await uploadWithRetry(attempt, [300, 800], sleep);

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([300]);
    expect(result).toEqual({ error: null, data: { path: "x" }, attempts: 2 });
  });

  it("agota los reintentos y devuelve el último error sin lanzar", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi
      .fn()
      .mockResolvedValue({ error: { message: "still failing", name: "StorageError" } });

    const result = await uploadWithRetry(attempt, [300, 800], sleep);

    expect(attempt).toHaveBeenCalledTimes(UPLOAD_MAX_ATTEMPTS);
    expect(calls).toEqual([300, 800]);
    expect(result).toEqual({ error: { message: "still failing", name: "StorageError" }, attempts: 3 });
  });

  it("reintenta ante una excepción y repropaga si el último intento también lanza", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(uploadWithRetry(attempt, [300, 800], sleep)).rejects.toThrow("fetch failed");
    expect(attempt).toHaveBeenCalledTimes(UPLOAD_MAX_ATTEMPTS);
    expect(calls).toEqual([300, 800]);
  });

  it("se recupera de una excepción si un intento posterior tiene éxito", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ error: null, data: { path: "x" } });

    const result = await uploadWithRetry(attempt, [300, 800], sleep);

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ error: null, data: { path: "x" }, attempts: 2 });
  });
});
