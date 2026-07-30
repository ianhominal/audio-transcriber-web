/**
 * Which model summarises a given text, and how much of it fits.
 *
 * The problem this solves, from a real report: summarising a long note answered 502 with Groq's raw
 * error — "Request too large for model `llama-3.1-8b-instant` ... Limit 6000, Requested 12234". On
 * the free tier that model allows 6.000 tokens per MINUTE, and a single request bigger than the cap
 * is rejected every time; it is not a transient rate limit that a retry would clear.
 *
 * Chunking alone does not fix it either: the cap is aggregated per minute and per ORGANISATION, so
 * four chunks of 3k tokens still spend 12k tokens inside the same window, and `maxDuration = 30`
 * leaves no room to wait between them. The fix is a model with room to breathe: Gemini's free tier
 * allows 250K TPM, enough to swallow a 3-hour meeting in one request — no map-reduce needed.
 *
 * Groq stays the engine for everything short: it is fast, already wired, and its cache covers most
 * requests.
 */

export type SummaryEngine = "groq" | "gemini";

/**
 * Input budget for Groq, in characters. Derived, not guessed: the request that failed asked for
 * 12.234 tokens on 40.000 characters, 2.048 of which were the reserved output — about 3,9 characters
 * per token. The WHOLE request (input + `max_tokens`) has to fit under 6.000, which leaves roughly
 * (6.000 - 2.048) tokens ≈ 15.400 characters of input. 14.000 keeps a margin for the system prompt
 * and for texts that tokenise worse than average. See the arithmetic test in `engine.test.ts`.
 */
export const GROQ_SAFE_SUMMARY_CHARS = 14_000;

/**
 * Input budget for Gemini. Same ceiling as the polish pipeline (`MAX_POLISH_INPUT_CHARS`): 200.000
 * characters is around a 3-hour meeting, and it is a cost/abuse bound rather than a model limit —
 * Gemini's context window is far larger than this.
 */
export const GEMINI_MAX_SUMMARY_CHARS = 200_000;

export type SummaryPlan = {
  engine: SummaryEngine;
  /** Characters to actually send. The caller slices to this. */
  maxChars: number;
  /** `true` when the text did not fit and got cut — the caller MUST tell the user. */
  truncated: boolean;
};

/**
 * Picks the engine for a text of `chars` characters.
 *
 * Without a Gemini key configured, a long text degrades to "Groq over the beginning of the text"
 * instead of failing: a partial summary the user is TOLD about beats the raw 502 they used to get.
 * What it must never do is cut silently — that was the other half of this bug, where a 3-hour
 * meeting was sliced to 40.000 characters and summarised from its first third with nobody the wiser.
 */
export function planSummary({ chars, hasGeminiKey }: { chars: number; hasGeminiKey: boolean }): SummaryPlan {
  if (chars <= GROQ_SAFE_SUMMARY_CHARS) {
    return { engine: "groq", maxChars: GROQ_SAFE_SUMMARY_CHARS, truncated: false };
  }

  if (!hasGeminiKey) {
    return { engine: "groq", maxChars: GROQ_SAFE_SUMMARY_CHARS, truncated: true };
  }

  return {
    engine: "gemini",
    maxChars: GEMINI_MAX_SUMMARY_CHARS,
    truncated: chars > GEMINI_MAX_SUMMARY_CHARS,
  };
}
