import { describe, it, expect, vi } from "vitest";
import { buildSummaryRequest, summarizeText, MAX_SUMMARY_INPUT_CHARS } from "./groq";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

const VALID_SUMMARY_JSON = JSON.stringify({
  summary: "El texto habla de X.",
  keyPoints: ["Punto 1"],
  actionItems: ["Tarea 1"],
});

describe("buildSummaryRequest", () => {
  it("usa el modelo barato de Groq, pide JSON mode y manda el texto como mensaje de usuario", () => {
    const req = buildSummaryRequest("hola mundo", "Español");
    expect(req.model).toBe("llama-3.1-8b-instant");
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req.messages[1]).toEqual({ role: "user", content: "hola mundo" });
  });

  it("el prompt del sistema nombra el idioma pedido y describe el schema JSON", () => {
    const req = buildSummaryRequest("hola", "Inglés");
    const system = req.messages[0].content;
    expect(system).toContain("Inglés");
    expect(system).toContain("summary");
    expect(system).toContain("keyPoints");
    expect(system).toContain("actionItems");
    expect(system).toMatch(/nunca inventes/i);
  });

  it("con languageLabel null pide resumir en el MISMO idioma que el texto (no fuerza uno)", () => {
    const system = buildSummaryRequest("bonjour", null).messages[0].content;
    expect(system).toMatch(/mismo idioma/i);
    expect(system).not.toMatch(/tiene que estar en Español/i);
  });
});

describe("summarizeText", () => {
  it("devuelve el resumen estructurado cuando Groq responde OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: VALID_SUMMARY_JSON } }] })
    );
    const result = await summarizeText("texto largo...", "Español", "key", fetchMock);
    expect(result).toEqual({
      ok: true,
      summary: { summary: "El texto habla de X.", keyPoints: ["Punto 1"], actionItems: ["Tarea 1"] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("devuelve ok:false ante un error HTTP de Groq, sin lanzar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "rate limited" } }, { ok: false, status: 429 }));
    const result = await summarizeText("texto", "Español", "key", fetchMock);
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("devuelve ok:false si Groq no manda contenido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const result = await summarizeText("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si el contenido no es JSON parseable como resumen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "esto no es JSON" } }] })
    );
    const result = await summarizeText("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok:false si el fetch rechaza (sin red), sin lanzar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await summarizeText("texto", "Español", "key", fetchMock);
    expect(result.ok).toBe(false);
  });

  it("recorta el texto a MAX_SUMMARY_INPUT_CHARS antes de mandarlo a Groq", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: VALID_SUMMARY_JSON } }] })
    );
    const huge = "a".repeat(MAX_SUMMARY_INPUT_CHARS + 5000);
    await summarizeText(huge, "Español", "key", fetchMock);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content.length).toBe(MAX_SUMMARY_INPUT_CHARS);
  });
});
