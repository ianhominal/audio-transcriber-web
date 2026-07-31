import { describe, it, expect } from "vitest";
import { describeFetchFailure } from "./fetch-failure";

/**
 * Why this exists: a tester queued 14 files from an Android phone, hit "Transcribir", and every
 * single one failed. Vercel's logs showed ZERO POSTs to /api/transcribe — not one request left the
 * device. Our `catch {}` swallowed the exception, so all we could show was a generic "no se pudo
 * conectar", and we had no way to tell a dead network from a dead file handle.
 */
describe("describeFetchFailure", () => {
  it("reconoce el archivo que el teléfono ya no deja leer", () => {
    // Android hands out `content://` references from other apps (WhatsApp, Drive, la grabadora).
    // Those go stale, and reading the blob to build the body throws instead of hitting the network.
    const error = Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" });

    const result = describeFetchFailure(error);

    expect(result.kind).toBe("unreadable-file");
    expect(result.message).toContain("volvé a elegirlo");
  });

  it("reconoce el archivo ilegible también por el texto del error", () => {
    const error = new Error("A requested file or directory could not be found at the time an operation was processed");

    expect(describeFetchFailure(error).kind).toBe("unreadable-file");
  });

  it("reconoce una caída de red real", () => {
    const error = new TypeError("Failed to fetch");

    const result = describeFetchFailure(error);

    expect(result.kind).toBe("network");
    expect(result.message).toContain("señal");
  });

  it("reconoce una subida cancelada", () => {
    const error = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });

    expect(describeFetchFailure(error).kind).toBe("aborted");
  });

  // The whole point: whatever we could not classify must still reach the user's screen and the
  // recording's `lastError`, so the next report tells us what actually happened.
  it("conserva el detalle técnico de un error desconocido, en vez de tragárselo", () => {
    const error = Object.assign(new Error("boom interno"), { name: "WeirdError" });

    const result = describeFetchFailure(error);

    expect(result.kind).toBe("unknown");
    expect(result.detail).toContain("WeirdError");
    expect(result.detail).toContain("boom interno");
  });

  it("tolera que lo lanzado no sea un Error", () => {
    expect(describeFetchFailure("algo raro").kind).toBe("unknown");
    expect(describeFetchFailure(undefined).kind).toBe("unknown");
    expect(describeFetchFailure(null).message.length).toBeGreaterThan(0);
  });

  it("nunca devuelve un mensaje vacío", () => {
    const casos: unknown[] = [new TypeError("Failed to fetch"), new Error(""), null, 42];
    for (const caso of casos) expect(describeFetchFailure(caso).message.length).toBeGreaterThan(0);
  });
});
