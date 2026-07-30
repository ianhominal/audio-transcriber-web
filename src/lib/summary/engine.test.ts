import { describe, expect, it } from "vitest";
import {
  planSummary,
  GROQ_SAFE_SUMMARY_CHARS,
  GEMINI_MAX_SUMMARY_CHARS,
} from "./engine";

/**
 * Why this exists: Groq's free tier caps llama-3.1-8b-instant at 6.000 tokens per MINUTE, and a
 * request bigger than that cap is rejected outright ("Request too large") — it is not a transient
 * rate limit, it fails every single time. A long transcription therefore could never be summarised.
 *
 * Chunking alone does not save us: the cap is aggregated per minute across the whole organisation,
 * so N chunks still add up to the same tokens inside the same window, and maxDuration=30 leaves no
 * room to wait it out. Gemini's free tier allows 250K TPM, which swallows a 3-hour meeting whole.
 */
describe("planSummary", () => {
  it("uses Groq for a short text, untouched", () => {
    const plan = planSummary({ chars: 5_000, hasGeminiKey: true });
    expect(plan.engine).toBe("groq");
    expect(plan.truncated).toBe(false);
  });

  it("still uses Groq right at the safe limit", () => {
    const plan = planSummary({ chars: GROQ_SAFE_SUMMARY_CHARS, hasGeminiKey: true });
    expect(plan.engine).toBe("groq");
    expect(plan.truncated).toBe(false);
  });

  it("switches to Gemini one character past the limit", () => {
    const plan = planSummary({ chars: GROQ_SAFE_SUMMARY_CHARS + 1, hasGeminiKey: true });
    expect(plan.engine).toBe("gemini");
    expect(plan.truncated).toBe(false);
  });

  it("sends a 3-hour meeting to Gemini whole, without cutting it", () => {
    // ~180k characters: the top end of a long meeting. This is the case that used to be silently
    // sliced to 40k, i.e. summarised from its first third only.
    const plan = planSummary({ chars: 180_000, hasGeminiKey: true });
    expect(plan.engine).toBe("gemini");
    expect(plan.maxChars).toBe(GEMINI_MAX_SUMMARY_CHARS);
    expect(plan.truncated).toBe(false);
  });

  it("truncates only beyond Gemini's own cap, and says so", () => {
    const plan = planSummary({ chars: GEMINI_MAX_SUMMARY_CHARS + 1, hasGeminiKey: true });
    expect(plan.engine).toBe("gemini");
    expect(plan.truncated).toBe(true);
  });

  describe("without a Gemini key configured", () => {
    it("keeps short texts on Groq exactly as before", () => {
      const plan = planSummary({ chars: 5_000, hasGeminiKey: false });
      expect(plan.engine).toBe("groq");
      expect(plan.truncated).toBe(false);
    });

    it("falls back to Groq on a trimmed text instead of failing outright", () => {
      // Degrading to "a summary of the beginning" beats the raw Groq 502 the user used to get, but
      // it MUST be reported as truncated so the UI can say so — never silently.
      const plan = planSummary({ chars: 120_000, hasGeminiKey: false });
      expect(plan.engine).toBe("groq");
      expect(plan.maxChars).toBe(GROQ_SAFE_SUMMARY_CHARS);
      expect(plan.truncated).toBe(true);
    });
  });

  it("keeps the Groq budget under the 6.000 TPM cap once the output is accounted for", () => {
    // The failing request asked for 12.234 tokens on 40.000 characters, of which 2.048 were the
    // reserved output: ~3,9 characters per token. The whole request (input + max_tokens) has to fit
    // in 6.000, so the input budget is (6.000 - 2.048) tokens. This is the arithmetic that decides
    // GROQ_SAFE_SUMMARY_CHARS — if someone raises it, this test explains why they should not.
    const CHARS_PER_TOKEN = 3.9;
    const RESERVED_OUTPUT_TOKENS = 2_048;
    const estimatedTokens = GROQ_SAFE_SUMMARY_CHARS / CHARS_PER_TOKEN + RESERVED_OUTPUT_TOKENS;
    expect(estimatedTokens).toBeLessThan(6_000);
  });
});
