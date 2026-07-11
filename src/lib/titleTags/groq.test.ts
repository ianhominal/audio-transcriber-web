import { describe, it, expect, vi } from "vitest";
import {
  buildTitleTagsRequest,
  generateTitleAndTags,
  MAX_TITLE_TAGS_INPUT_CHARS,
  TITLE_TAGS_TIMEOUT_MS,
} from "./groq";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

const VALID_JSON = JSON.stringify({
  title: "Reunión de planificación semanal",
  tags: ["reunión", "planificación"],
});

describe("buildTitleTagsRequest", () => {
  it("usa el modelo barato de Groq, pide JSON mode y manda el texto como mensaje de usuario", () => {
    const req = buildTitleTagsRequest("hola mundo", "Español");
    expect(req.model).toBe("llama-3.1-8b-instant");
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req.messages[1]).toEqual({ role: "user", content: "hola mundo" });
  });

  it("el prompt del sistema describe el schema JSON y pide título de 5-8 palabras + 3-5 tags", () => {
    const system = buildTitleTagsRequest("hola", "Español").messages[0].content;
    expect(system).toContain("title");
    expect(system).toContain("tags");
    expect(system).toMatch(/5 a 8 palabras/);
    expect(system).toMatch(/3 y 5 etiquetas/);
    expect(system).toMatch(/nunca inventes/i);
  });

  it("con languageLabel indica el idioma pedido", () => {
    const system = buildTitleTagsRequest("hola", "Inglés").messages[0].content;
    expect(system).toContain("Inglés");
  });

  it("con languageLabel null pide responder en el MISMO idioma que el texto (no fuerza uno)", () => {
    const system = buildTitleTagsRequest("bonjour", null).messages[0].content;
    expect(system).toMatch(/mismo idioma/i);
  });

  it("acota max_tokens de salida a un techo FIJO y bajo (no proporcional al input)", () => {
    const req = buildTitleTagsRequest("hola mundo", "Español");
    expect(req.max_tokens).toBe(300);
    const longReq = buildTitleTagsRequest("a".repeat(30000), "Español");
    expect(longReq.max_tokens).toBe(req.max_tokens);
  });
});

describe("generateTitleAndTags", () => {
  it("devuelve título+tags cuando Groq responde OK", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: VALID_JSON }, finish_reason: "stop" }] }));
    const result = await generateTitleAndTags("texto largo...", "Español", "key", fetchMock);
    expect(result).toEqual({
      ok: true,
      result: { title: "Reunión de planificación semanal", tags: ["reunión", "planificación"] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("manda un AbortSignal (timeout propio) en el fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: VALID_JSON } }] }));
    await generateTitleAndTags("texto", "Español", "key", fetchMock);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("devuelve ok:false ante un error HTTP de Groq, sin lanzar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "rate limited" } }, { ok: false, status: 429 }));
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("devuelve ok:false si Groq no manda contenido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si el contenido no es JSON parseable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "esto no es JSON" } }] }));
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si Groq TRUNCÓ la salida (finish_reason='length'), aunque haya contenido parcial", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"title": "algo cort' }, finish_reason: "length" }] })
    );
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:true normalmente cuando finish_reason es 'stop'", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: VALID_JSON }, finish_reason: "stop" }] }));
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(true);
  });

  it("devuelve ok:false si el fetch rechaza (red caída o timeout abortó), sin lanzar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const result = await generateTitleAndTags("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("recorta el texto a MAX_TITLE_TAGS_INPUT_CHARS antes de mandarlo a Groq", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: VALID_JSON } }] }));
    const huge = "a".repeat(MAX_TITLE_TAGS_INPUT_CHARS + 5000);
    await generateTitleAndTags(huge, "Español", "key", fetchMock);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content.length).toBe(MAX_TITLE_TAGS_INPUT_CHARS);
  });

  it("expone TITLE_TAGS_TIMEOUT_MS como una constante razonable (unos pocos segundos)", () => {
    expect(TITLE_TAGS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TITLE_TAGS_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
