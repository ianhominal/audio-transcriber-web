import { describe, it, expect } from "vitest";
import {
  isAiSummaryDailyLimitError,
  isAiSummaryForceLimitError,
  isAiChatDailyLimitError,
  isAiTitleTagsDailyLimitError,
} from "./aiUsage";

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

describe("isAiChatDailyLimitError", () => {
  it("detecta el token del límite diario de chat en el mensaje del trigger", () => {
    expect(isAiChatDailyLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(true);
    expect(
      isAiChatDailyLimitError({ message: 'error: ai_chat_daily_limit_reached (PL/pgSQL function ...)' })
    ).toBe(true);
  });

  it("NO confunde el token de chat con los de resumen y viceversa", () => {
    expect(isAiChatDailyLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(false);
    expect(isAiChatDailyLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryDailyLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryForceLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiChatDailyLimitError(null)).toBe(false);
    expect(isAiChatDailyLimitError(undefined)).toBe(false);
    expect(isAiChatDailyLimitError({})).toBe(false);
    expect(isAiChatDailyLimitError({ message: 42 })).toBe(false);
  });
});

describe("isAiTitleTagsDailyLimitError", () => {
  it("detecta el token del límite diario de título+tags en el mensaje del trigger", () => {
    expect(isAiTitleTagsDailyLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(true);
    expect(
      isAiTitleTagsDailyLimitError({ message: "error: ai_title_tags_daily_limit_reached (PL/pgSQL function ...)" })
    ).toBe(true);
  });

  it("NO confunde el token de título+tags con los de resumen/chat y viceversa", () => {
    expect(isAiTitleTagsDailyLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(false);
    expect(isAiTitleTagsDailyLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(false);
    expect(isAiTitleTagsDailyLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryDailyLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryForceLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(false);
    expect(isAiChatDailyLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiTitleTagsDailyLimitError(null)).toBe(false);
    expect(isAiTitleTagsDailyLimitError(undefined)).toBe(false);
    expect(isAiTitleTagsDailyLimitError({})).toBe(false);
    expect(isAiTitleTagsDailyLimitError({ message: 42 })).toBe(false);
  });
});
