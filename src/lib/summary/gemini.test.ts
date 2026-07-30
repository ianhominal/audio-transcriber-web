import { describe, expect, it, vi } from "vitest";
import { buildGeminiSummaryRequest, summarizeTextWithGemini, GEMINI_SUMMARY_MODEL } from "./gemini";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Shape Gemini returns for a successful generateContent call. */
function geminiSuccess(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe("buildGeminiSummaryRequest", () => {
  it("asks for JSON output and pins the temperature low", () => {
    const req = buildGeminiSummaryRequest("hola", "español");
    expect(req.generationConfig.responseMimeType).toBe("application/json");
    expect(req.generationConfig.temperature).toBe(0.2);
  });

  it("caps the output so a runaway answer cannot get expensive", () => {
    // Same reasoning as the Groq path: a summary is short BY DESIGN, so the ceiling is a fixed
    // value and does not scale with the input.
    const req = buildGeminiSummaryRequest("hola", null);
    expect(req.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("puts the rules in a system instruction and only the text in the user turn", () => {
    const req = buildGeminiSummaryRequest("el texto de la nota", "español");
    expect(req.systemInstruction.parts[0].text).toContain("summary");
    expect(req.contents[0].parts[0].text).toBe("el texto de la nota");
  });

  it("pins the summary language when it is known", () => {
    const req = buildGeminiSummaryRequest("hola", "português");
    expect(req.systemInstruction.parts[0].text).toContain("português");
  });

  it("asks for the source language when it is unknown, instead of forcing one", () => {
    // Same bug the Groq path already fixed: forcing Spanish broke audio in French, Portuguese, etc.
    const req = buildGeminiSummaryRequest("bonjour", null);
    expect(req.systemInstruction.parts[0].text).toContain("MISMO idioma");
  });
});

describe("summarizeTextWithGemini", () => {
  const KEY = "test-key";

  it("parses a well-formed answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        geminiSuccess(
          JSON.stringify({ summary: "Un resumen.", keyPoints: ["uno", "dos"], actionItems: ["hacer algo"] })
        )
      )
    );

    const result = await summarizeTextWithGemini("texto", "español", KEY, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toBe("Un resumen.");
      expect(result.summary.keyPoints).toEqual(["uno", "dos"]);
      expect(result.summary.actionItems).toEqual(["hacer algo"]);
    }
  });

  it("sends the key in the header and never in the URL", async () => {
    // A key on the query string leaks into logs, proxies and browser history.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(geminiSuccess(JSON.stringify({ summary: "ok" }))));

    await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).not.toContain(KEY);
    expect(url).toContain(GEMINI_SUMMARY_MODEL);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
  });

  it("reports an HTTP failure without throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "quota exceeded" } }, 429));

    const result = await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("quota exceeded");
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });

  it("reports an empty answer instead of inventing a summary", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ candidates: [] }));
    const result = await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });

  it("survives an answer wrapped in a Markdown code fence", async () => {
    // parseModelSummaryResponse already strips fences; this keeps the behaviour pinned for Gemini too.
    const fenced = "```json\n" + JSON.stringify({ summary: "Con fence." }) + "\n```";
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(geminiSuccess(fenced)));

    const result = await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary.summary).toBe("Con fence.");
  });

  it("reports a blocked answer as a failure, not as an empty summary", async () => {
    // Gemini can return no parts with a finishReason of SAFETY.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }));

    const result = await summarizeTextWithGemini("texto", null, KEY, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
  });
});
