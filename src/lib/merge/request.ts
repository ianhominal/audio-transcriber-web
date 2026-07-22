/**
 * Body of `POST /api/notes/merge` — PURE, no `fetch`, so both entry points send EXACTLY the same
 * shape: the dedicated page (`merge-view.tsx`, `/app/merge`) and the "Combinar en documento" action
 * embedded in the project-scoped assistant (`ChatPanel`, feature 2026-07-22 phase 2 — see
 * `useMergeStream`). `rawInstruction` is trimmed; an empty result is sent as `""`, equivalent to "no
 * instruction" server-side (`sanitizeMergeInstruction`, `./validate.ts`, already treats `""` and
 * "no instruction" the same).
 */
export type MergeRequestBody = { transcriptionIds: string[]; instruction: string };

export function buildMergeRequestBody(transcriptionIds: string[], rawInstruction: string): MergeRequestBody {
  return { transcriptionIds, instruction: rawInstruction.trim() };
}
