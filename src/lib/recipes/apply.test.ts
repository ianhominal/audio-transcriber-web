import { describe, it, expect, beforeEach, vi } from "vitest";

// `generateText` hace red real hacia Groq — se mockea para poder testear `applyRecipeText` (timeout/
// error handling/shape del resultado) SIN llamar a un LLM de verdad, mismo patrón que
// `api/chat/route.test.ts`.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

vi.mock("@ai-sdk/groq", () => ({
  groq: vi.fn(() => ({ __fakeGroqModel: true })),
}));

import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { RECIPE_MODEL, buildRecipeModelCall, applyRecipeText, DEFAULT_RECIPE_TIMEOUT_MS } from "./apply";

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(groq).mockClear();
});

describe("buildRecipeModelCall", () => {
  it("arma { model, prompt } con el modelo de formatos y el prompt de buildRecipePrompt", () => {
    const call = buildRecipeModelCall("Resumí en 3 bullets", "Texto de la nota.");
    expect(groq).toHaveBeenCalledWith(RECIPE_MODEL);
    expect(call.prompt).toContain("Resumí en 3 bullets");
    expect(call.prompt).toContain("Texto de la nota.");
  });
});

describe("applyRecipeText", () => {
  it("devuelve { ok: true, text } con la salida (trimeada) del modelo", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "  Resultado generado.  " } as never);

    const result = await applyRecipeText("Instrucción", "Texto de la nota.");

    expect(result).toEqual({ ok: true, text: "Resultado generado." });
  });

  it("llama a generateText con el modelo/prompt correctos y un abortSignal con timeout", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "Resultado." } as never);

    await applyRecipeText("Instrucción", "Texto de la nota.", 5_000);

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(groq).toHaveBeenCalledWith(RECIPE_MODEL);
    expect(call.prompt).toContain("Instrucción");
    expect(call.prompt).toContain("Texto de la nota.");
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("usa DEFAULT_RECIPE_TIMEOUT_MS cuando no se pasa un timeout explícito", () => {
    expect(DEFAULT_RECIPE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("devuelve { ok: false } (nunca lanza) si generateText tira una excepción (timeout/red/proveedor)", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("timeout"));

    const result = await applyRecipeText("Instrucción", "Texto de la nota.");

    expect(result.ok).toBe(false);
  });

  it("devuelve { ok: false } si el modelo devuelve texto vacío", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "   " } as never);

    const result = await applyRecipeText("Instrucción", "Texto de la nota.");

    expect(result).toEqual({ ok: false, error: "El modelo no devolvió contenido." });
  });
});
