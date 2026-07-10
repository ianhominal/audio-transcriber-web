import { describe, it, expect, vi } from "vitest";
import { buildCorrectionRequest, correctTextWithVocabulary, MAX_CORRECTION_INPUT_CHARS } from "./groq";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe("buildCorrectionRequest", () => {
  it("usa el modelo barato de Groq con temperatura 0 (máxima literalidad)", () => {
    const req = buildCorrectionRequest("hola mundo", ["Valentino"]);
    expect(req.model).toBe("llama-3.1-8b-instant");
    expect(req.temperature).toBe(0);
  });

  it("incluye la lista de términos en el prompt del sistema y el texto como mensaje de usuario", () => {
    const req = buildCorrectionRequest("hola balen tino", ["Valentino", "Fulanito FM"]);
    const system = req.messages[0].content;
    expect(system).toContain("Valentino");
    expect(system).toContain("Fulanito FM");
    expect(req.messages[1]).toEqual({ role: "user", content: "hola balen tino" });
  });

  it("el prompt pide NO reescribir ni inventar, solo corregir fonéticamente", () => {
    const req = buildCorrectionRequest("hola", ["Valentino"]);
    const system = req.messages[0].content;
    expect(system).toMatch(/no reescribas/i);
    expect(system).toMatch(/no inventes/i);
  });

  it("acota max_tokens de forma proporcional al input y bajo el techo duro", () => {
    const shortReq = buildCorrectionRequest("hola", ["Valentino"]);
    expect(shortReq.max_tokens).toBeGreaterThan(0);
    expect(shortReq.max_tokens).toBeLessThanOrEqual(8000);

    // Un input más largo pide más tokens que uno corto, pero nunca supera el techo.
    const longReq = buildCorrectionRequest("a".repeat(4000), ["Valentino"]);
    expect(longReq.max_tokens).toBeGreaterThan(shortReq.max_tokens);
    expect(longReq.max_tokens).toBeLessThanOrEqual(8000);
  });
});

describe("correctTextWithVocabulary", () => {
  it("no llama a Groq si no hay términos cargados (ahorro)", async () => {
    const fetchMock = vi.fn();
    const result = await correctTextWithVocabulary("hola balen tino", [], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "hola balen tino", corrected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no llama a Groq con texto vacío", async () => {
    const fetchMock = vi.fn();
    const result = await correctTextWithVocabulary("   ", ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "   ", corrected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no llama a Groq ni corrige si el texto supera el cap de input (evita perder texto por truncar)", async () => {
    const fetchMock = vi.fn();
    const longText = "a".repeat(MAX_CORRECTION_INPUT_CHARS + 1);
    const result = await correctTextWithVocabulary(longText, ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: longText, corrected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("devuelve el texto corregido y corrected:true cuando Groq cambió algo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hola Valentino" } }] })
    );
    const result = await correctTextWithVocabulary("hola balen tino", ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "hola Valentino", corrected: true });
  });

  it("devuelve corrected:false cuando Groq no encontró nada para corregir (texto sin cambios)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hola mundo" } }] })
    );
    const result = await correctTextWithVocabulary("hola mundo", ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "hola mundo", corrected: false });
  });

  it("descarta un output desproporcionadamente largo (posible desvío del modelo) y deja el texto original", async () => {
    const original = "hola balen tino";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "a".repeat(200) } }] })
    );
    const result = await correctTextWithVocabulary(original, ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: original, corrected: false });
  });

  it("descarta un output desproporcionadamente corto (posible truncado) y deja el texto original", async () => {
    const original = "hola balen tino, contame de vos";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ho" } }] })
    );
    const result = await correctTextWithVocabulary(original, ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: true, text: original, corrected: false });
  });

  it("devuelve ok:false ante un error HTTP de Groq, sin lanzar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "rate limited" } }, { ok: false, status: 429 }));
    const result = await correctTextWithVocabulary("hola", ["Valentino"], "key", fetchMock);
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("devuelve ok:false si Groq no manda contenido corregido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const result = await correctTextWithVocabulary("hola", ["Valentino"], "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si el fetch rechaza (sin red), sin lanzar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await correctTextWithVocabulary("hola", ["Valentino"], "key", fetchMock);
    expect(result.ok).toBe(false);
  });
});
