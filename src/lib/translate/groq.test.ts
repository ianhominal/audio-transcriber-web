import { describe, it, expect, vi } from "vitest";
import { buildTranslationRequest, translateText, MAX_TRANSLATION_INPUT_CHARS } from "./groq";

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

  it("acota max_tokens de forma proporcional al input y bajo el techo duro", () => {
    const shortReq = buildTranslationRequest("hola", "Inglés");
    expect(shortReq.max_tokens).toBeGreaterThan(0);
    expect(shortReq.max_tokens).toBeLessThanOrEqual(8000);

    // Un input más largo pide más tokens que uno corto, pero nunca supera el techo.
    const longReq = buildTranslationRequest("a".repeat(4000), "Inglés");
    expect(longReq.max_tokens).toBeGreaterThan(shortReq.max_tokens);
    expect(longReq.max_tokens).toBeLessThanOrEqual(8000);
  });

  it("un input GRANDE (>15k chars) SATURA max_tokens en el techo (8000) — puede truncar la salida", () => {
    // Con el cálculo ceil(len/2)+256, a partir de ~15.5k chars el valor pediría más de 8000 y queda
    // capado en el techo. Un input de 20k chars (aún dentro del cap de input de 40k que se ACEPTA)
    // ya satura — de ahí que una traducción de ese texto pueda cortarse por `finish_reason: length`.
    const saturatedReq = buildTranslationRequest("a".repeat(20_000), "Inglés");
    expect(saturatedReq.max_tokens).toBe(8000);
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

  it("devuelve ok:false si Groq TRUNCÓ la salida (finish_reason='length') aunque haya contenido parcial", async () => {
    // Simula la saturación de max_tokens sobre un input grande: Groq devuelve texto PARCIAL con
    // finish_reason 'length'. No se debe devolver ese parcial como ok:true (perdería la cola) —
    // CRÍTICO #2 del review adversarial 2026-07-10.
    const bigInput = "a".repeat(20_000);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "traducción parcial cortada a la mitad" }, finish_reason: "length" }] })
    );
    const result = await translateText(bigInput, "Inglés", "key", fetchMock);
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("devuelve ok:true normalmente cuando finish_reason es 'stop' (traducción completa)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hello world" }, finish_reason: "stop" }] })
    );
    const result = await translateText("hola mundo", "Inglés", "key", fetchMock);
    expect(result).toEqual({ ok: true, text: "hello world" });
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

  it("no llama a Groq ni traduce si el texto supera el cap de input (evita perder texto por truncar)", async () => {
    const fetchMock = vi.fn();
    const longText = "a".repeat(MAX_TRANSLATION_INPUT_CHARS + 1);
    const result = await translateText(longText, "Inglés", "key", fetchMock);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
