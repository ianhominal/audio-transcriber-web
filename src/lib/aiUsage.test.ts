import { describe, it, expect } from "vitest";
import {
  isAiSummaryDailyLimitError,
  isAiSummaryForceLimitError,
  isAiChatDailyLimitError,
  isAiTitleTagsDailyLimitError,
  isAiRecipeDailyLimitError,
  isAiMergeDailyLimitError,
  isAiBrainDailyLimitError,
  isAiPolishDailyLimitError,
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

describe("isAiRecipeDailyLimitError", () => {
  it("detecta el token del límite diario de formatos en el mensaje del trigger", () => {
    expect(isAiRecipeDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(true);
    expect(
      isAiRecipeDailyLimitError({ message: "error: ai_recipe_daily_limit_reached (PL/pgSQL function ...)" })
    ).toBe(true);
  });

  it("NO confunde el token de formatos con los de resumen/chat/título+tags y viceversa", () => {
    expect(isAiRecipeDailyLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryForceLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiChatDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiTitleTagsDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiRecipeDailyLimitError(null)).toBe(false);
    expect(isAiRecipeDailyLimitError(undefined)).toBe(false);
    expect(isAiRecipeDailyLimitError({})).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: 42 })).toBe(false);
  });
});

describe("isAiMergeDailyLimitError", () => {
  it("detecta el token del límite diario de uniones en el mensaje del trigger", () => {
    expect(isAiMergeDailyLimitError({ message: "ai_merge_daily_limit_reached" })).toBe(true);
    expect(
      isAiMergeDailyLimitError({ message: "error: ai_merge_daily_limit_reached (PL/pgSQL function ...)" })
    ).toBe(true);
  });

  it("NO confunde el token de uniones con los demás y viceversa", () => {
    expect(isAiMergeDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: "ai_merge_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiMergeDailyLimitError(null)).toBe(false);
    expect(isAiMergeDailyLimitError(undefined)).toBe(false);
    expect(isAiMergeDailyLimitError({})).toBe(false);
    expect(isAiMergeDailyLimitError({ message: 42 })).toBe(false);
  });
});

describe("isAiBrainDailyLimitError", () => {
  it("detecta el token del límite diario del Segundo cerebro en el mensaje del trigger", () => {
    expect(isAiBrainDailyLimitError({ message: "ai_brain_daily_limit_reached" })).toBe(true);
    expect(
      isAiBrainDailyLimitError({ message: "error: ai_brain_daily_limit_reached (PL/pgSQL function ...)" })
    ).toBe(true);
  });

  it("NO confunde el token del Segundo cerebro con los demás y viceversa (incluido 'merge', que comparte prefijo 'ai_')", () => {
    expect(isAiBrainDailyLimitError({ message: "ai_summary_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_summary_force_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_chat_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_title_tags_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_merge_daily_limit_reached" })).toBe(false);
    expect(isAiSummaryDailyLimitError({ message: "ai_brain_daily_limit_reached" })).toBe(false);
    expect(isAiChatDailyLimitError({ message: "ai_brain_daily_limit_reached" })).toBe(false);
    expect(isAiMergeDailyLimitError({ message: "ai_brain_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiBrainDailyLimitError(null)).toBe(false);
    expect(isAiBrainDailyLimitError(undefined)).toBe(false);
    expect(isAiBrainDailyLimitError({})).toBe(false);
    expect(isAiBrainDailyLimitError({ message: 42 })).toBe(false);
  });
});

describe("isAiPolishDailyLimitError", () => {
  it("detecta el token del límite diario de pulido en el mensaje del trigger", () => {
    expect(isAiPolishDailyLimitError({ message: "ai_polish_daily_limit_reached" })).toBe(true);
    expect(
      isAiPolishDailyLimitError({ message: "error: ai_polish_daily_limit_reached (PL/pgSQL function ...)" })
    ).toBe(true);
  });

  it("NO confunde el token de pulido con los demás y viceversa", () => {
    expect(isAiPolishDailyLimitError({ message: "ai_recipe_daily_limit_reached" })).toBe(false);
    expect(isAiPolishDailyLimitError({ message: "ai_brain_daily_limit_reached" })).toBe(false);
    expect(isAiRecipeDailyLimitError({ message: "ai_polish_daily_limit_reached" })).toBe(false);
    expect(isAiBrainDailyLimitError({ message: "ai_polish_daily_limit_reached" })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isAiPolishDailyLimitError(null)).toBe(false);
    expect(isAiPolishDailyLimitError(undefined)).toBe(false);
    expect(isAiPolishDailyLimitError({})).toBe(false);
    expect(isAiPolishDailyLimitError({ message: 42 })).toBe(false);
  });
});
