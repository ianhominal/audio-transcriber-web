import type { MergeSourceNote } from "./types";

/**
 * Caps and validation for "Merge several notes into one document" (feature 2026-07-13). PURE
 * function with no server-only dependencies on purpose — same reuse criteria as
 * `src/lib/recipes/validate.ts`: used both in `/api/notes/merge` (validate before calling Groq) and
 * in the UI (`merge-view.tsx`, to disable the input before hitting the endpoint).
 *
 * Selection: "merge all notes in a project" (NOT multi-select with checkboxes) — there's no
 * precedent for multi-select UI in this app (no `aria-pressed`/checkboxes anywhere) and the
 * dashboard (`src/app/app/page.tsx`) already works per-project via `?project=<id>`. Surgical change:
 * one new button + one new page, without touching the existing fetch/tree logic (Drive-sync v2,
 * subfolders, count roll-ups). Free multi-select remains a follow-up.
 */

/** Max length of the optional instruction — same value as recipes' `MAX_INSTRUCTION_LENGTH`
 * (`src/lib/recipes/validate.ts`), though here the field is optional (see `sanitizeMergeInstruction`). */
export const MAX_MERGE_INSTRUCTION_LENGTH = 2_000;

/** Character cap on the combined text sent as context when merging — same criteria and same value as
 * `MAX_RECIPE_INPUT_CHARS`/`MAX_SUMMARY_INPUT_CHARS`/`MAX_CHAT_CONTEXT_INPUT_CHARS`: a hard
 * cost/abuse defense, enforced here server-side, never trusting the client. */
export const MAX_MERGE_INPUT_CHARS = 40_000;

/** Minimum number of notes for "merging" to make sense (a single note isn't a merge). */
export const MIN_MERGE_NOTES = 2;

/** Maximum number of notes that can be merged in a single request — ceiling chosen for UI/cost, same
 * order of magnitude as `MAX_RECIPES` (`src/lib/recipes/validate.ts`). */
export const MAX_MERGE_NOTES = 20;

/**
 * Normalizes the optional "how to merge" instruction. Unlike recipes' `sanitizeInstruction` (there
 * the instruction is MANDATORY, `null` if missing), here it's OPTIONAL: if `input` isn't a string or
 * ends up empty after trimming, returns `""` — the caller falls back to a default (see
 * `buildMergePrompt`). If it exceeds `MAX_MERGE_INSTRUCTION_LENGTH` it gets TRUNCATED (not rejected —
 * it's a convenience field, not a critical instruction). Never throws.
 */
export function sanitizeMergeInstruction(input: unknown): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_MERGE_INSTRUCTION_LENGTH ? trimmed.slice(0, MAX_MERGE_INSTRUCTION_LENGTH) : trimmed;
}

/** true if `count` is within the allowed range for merging (`MIN_MERGE_NOTES`..`MAX_MERGE_NOTES`). */
export function canMergeNoteCount(count: number): boolean {
  return count >= MIN_MERGE_NOTES && count <= MAX_MERGE_NOTES;
}

export type CombineNoteTextsResult = {
  combinedText: string;
  truncated: boolean;
  includedCount: number;
};

/**
 * Combines the text of several notes into a single block to send to the model. Sorts by `createdAt`
 * ASCENDING (oldest first) BEFORE combining — without assuming `notes` already arrives sorted: these
 * notes represent an idea developed over several days, so chronological order is the one that makes
 * sense to read.
 *
 * Each note generates a block `## {title} ({short ISO date})\n{text}\n\n` — the date is included in
 * parens next to the title (in addition to the title alone) so the model has a sense of WHEN each
 * fragment was written, useful for weaving a coherent narrative across notes spread out over time,
 * without adding a separate section per note.
 *
 * Notes with NO text (empty after trim) are skipped entirely — they generate no block and don't
 * count toward `includedCount`: so if ALL requested notes are textless, `combinedText` ends up
 * genuinely `""` (the caller, `/api/notes/merge`, uses that to return 400 in that case — see the
 * route's comment).
 *
 * Blocks are concatenated in order up to `MAX_MERGE_INPUT_CHARS`: if adding the next COMPLETE block
 * would exceed the cap, it stops there (that partial block is NOT added) and marks `truncated: true`
 * with `includedCount` = number of notes included IN FULL. Edge case: if the FIRST block with text
 * already exceeds the cap on its own (one giant note), that note's text is truncated so the whole
 * block fits the cap (`includedCount: 1`, `truncated: true`) — so the result never ends up empty just
 * because a single note is too long.
 */
export function combineNoteTexts(notes: MergeSourceNote[]): CombineNoteTextsResult {
  if (notes.length === 0) return { combinedText: "", truncated: false, includedCount: 0 };

  const sorted = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let combinedText = "";
  let includedCount = 0;

  for (const note of sorted) {
    if (!note.text.trim()) continue; // note has no content: contributes nothing, skip it.

    const shortDate = note.createdAt.slice(0, 10);
    const block = `## ${note.title} (${shortDate})\n${note.text}\n\n`;

    if (combinedText.length + block.length <= MAX_MERGE_INPUT_CHARS) {
      combinedText += block;
      includedCount++;
      continue;
    }

    // Doesn't fit whole. If this is the FIRST block (nothing included yet), truncate this note's
    // text so the whole block fits within the cap — so `combinedText` never ends up empty just
    // because the first note is gigantic.
    if (includedCount === 0) {
      const header = `## ${note.title} (${shortDate})\n`;
      const footer = "\n\n";
      const availableForText = Math.max(0, MAX_MERGE_INPUT_CHARS - header.length - footer.length);
      combinedText = header + note.text.slice(0, availableForText) + footer;
      includedCount = 1;
    }

    return { combinedText, truncated: true, includedCount };
  }

  return { combinedText, truncated: false, includedCount };
}

const DEFAULT_MERGE_INSTRUCTION =
  "Unificá estas notas en un único documento coherente y bien organizado, sin repetir ideas ni " +
  "contradicciones, conservando la voz y las ideas originales de quien las escribió. Usá " +
  "subtítulos si ayuda a la lectura.";

/**
 * Builds the final prompt sent to the model to merge several notes — same style/framing as
 * `buildRecipePrompt` (`src/lib/recipes/validate.ts`): system instruction + user instruction framed
 * between `"""` + combined text between `"""`. If `instruction` (already sanitized by
 * `sanitizeMergeInstruction`) is `""`, `DEFAULT_MERGE_INSTRUCTION` is used as the effective
 * instruction.
 *
 * The system prompt makes explicit that the notes below are FRAGMENTS of ONE SAME idea thought out
 * at different times and must be woven into a single document — not a per-note summary. Based only
 * on what the notes say (doesn't invent data), responds in Spanish (the note text itself is written
 * by the user in Spanish, so the output must match), and the only output is the final document, with
 * no commentary about the task. NOTE: the instruction strings below (`DEFAULT_MERGE_INSTRUCTION` and
 * the prompt body) are the actual model prompt, not comments — they stay in Spanish on purpose,
 * because that's the language the model must answer in.
 */
export function buildMergePrompt(instruction: string, combinedText: string): string {
  const effectiveInstruction = instruction || DEFAULT_MERGE_INSTRUCTION;

  return (
    "Sos un asistente que UNE varias notas de audio transcriptas, escritas por la misma persona en " +
    "distintos momentos, en un ÚNICO documento coherente. Las notas de abajo son FRAGMENTOS de una " +
    "MISMA idea que se fue desarrollando con el tiempo — tu trabajo es TEJERLAS en un solo texto " +
    "corrido y bien organizado, no resumir cada nota por separado ni hacer una lista nota por nota. " +
    "Aplicá la siguiente instrucción sobre cómo organizar el documento final. Basate ÚNICAMENTE en lo " +
    "que dicen las notas — no inventes datos, nombres, cifras ni hechos que no estén ahí. Respondé " +
    "siempre en español, de forma clara y directa. Tu única salida es el documento final, sin " +
    "explicaciones previas ni comentarios sobre la tarea.\n\n" +
    "Instrucción:\n" +
    '"""\n' +
    effectiveInstruction +
    '\n"""\n\n' +
    "Notas a unir (ordenadas de la más vieja a la más nueva):\n" +
    '"""\n' +
    combinedText +
    '\n"""'
  );
}
