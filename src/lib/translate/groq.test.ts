import { describe, it, expect, vi } from "vitest";
import { buildTranslationRequest, translateText } from "./groq";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe("buildTranslationRequest", () => {
  it("usa el modelo barato de Groq y manda el texto como mensaje de usuario", () => {
    const req = buildTranslationRequest("hola mundo", "Inglés");
    expect(req.model).toBe("llama-3.1-8b-instant");
    expect(req.messages[1]).toEqual({ role: "user", content: "hola mundo" });
  });

  it("el prompt del sistema nombra el idioma destino y pide NO conversar", () => {
    const req = buildTranslationRequest("hola", "Portugués");
    const system = req.messages[0].content;
    expect(system).toContain("Portugués");
    expect(system).toMatch(/sin comentarios/i);
  });
});

describe("translateText", () => {
  it("devuelve el texto traducido cuando Groq responde OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hello world" } }] })
    );
    const result = await translateText("hola mundo", "Inglés", "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "hello world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("devuelve ok:false ante un error HTTP de Groq, sin lanzar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "rate limited" } }, { ok: false, status: 429 }));
    const result = await translateText("hola", "Inglés", "key", fetchMock);
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("devuelve ok:false si Groq no manda contenido traducido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const result = await translateText("hola", "Inglés", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si el fetch rechaza (sin red), sin lanzar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await translateText("hola", "Inglés", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("no llama a Groq con texto vacío — devuelve ok:true con texto vacío", async () => {
    const fetchMock = vi.fn();
    const result = await translateText("   ", "Inglés", "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
