import { describe, it, expect } from "vitest";
import { isAiSummaryDailyLimitError, isAiSummaryForceLimitError } from "./aiUsage";

describe("isAiSummaryDailyLimitError / isAiSummaryForceLimitError", () => {
  it("detecta el token del límite diario en el mensaje del trigger", () => {
    expect(isAiSummaryDailyLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(true);
    // PostgREST suele envolver el mensaje con contexto alrededor — igual se detecta por substring.
    expect(
      isAiSummaryDailyLimitError({ message: 'error: ai_summary_daily_limit_reached (PL/pgSQL function ...)' })
    ).toBe(true);
  });

  it("detecta el token del límite de regeneraciones", () => {
    expect(isAiSummaryForceLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(true);
  });

  it("NO confunde el token diario con el de regeneraciones y viceversa", () => {
    // El token de force CONTIENE 'ai_summary_' pero no el substring exacto del diario.
    expect(isAiSummaryDailyLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryForceLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiSummaryDailyLimitError(null)).toBe(false);
    expect(isAiSummaryDailyLimitError(undefined)).toBe(false);
    expect(isAiSummaryDailyLimitError({})).toBe(false);
    expect(isAiSummaryDailyLimitError({ message: 42 })).toBe(false);
    expect(isAiSummaryForceLimitError(null)).toBe(false);
    expect(isAiSummaryForceLimitError({ message: "otro error cualquiera" })).toBe(false);
  });
});
