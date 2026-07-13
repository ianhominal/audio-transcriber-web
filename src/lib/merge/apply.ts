import { groq } from "@ai-sdk/groq";
import { buildMergePrompt } from "./validate";

// Same model as `RECIPE_MODEL` (`src/lib/recipes/apply.ts`) — that constant is NOT imported here, to
// avoid coupling `merge` to `recipes` (two independent features that happen to share a provider/model
// today by coincidence, not by design — same decoupling criteria documented in `recipes/apply.ts`):
// "merging notes" produces an output the user publishes DIRECTLY (a final document, not a draft), so
// it needs the same conversational/writing quality as "apply a format".
export const MERGE_MODEL = "llama-3.3-70b-versatile";

/**
 * Builds the args (`model`, `prompt`) passed to `streamText` in `/api/notes/merge` — single source of
 * truth for "which model and which prompt is used to merge notes", same criteria as
 * `buildRecipeModelCall`.
 */
export function buildMergeModelCall(instruction: string, combinedText: string) {
  return { model: groq(MERGE_MODEL), prompt: buildMergePrompt(instruction, combinedText) };
}
