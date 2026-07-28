/**
 * Team Sharing slice 1b, Phase 10 (design ADR-14 §1, spec "Detección de audio faltante al
 * compartir"). PURE transform: given the raw rows returned by the design §3.1 ADR-14 query
 * (notes in the project's subtree without an uploaded audio blob), derives the
 * `{ missingAudioCount, items }` shape the endpoint returns. Kept pure and separate from the
 * route's I/O (subtree resolution needs the DB) so the counting/shaping rule itself is unit
 * tested without a real Supabase client.
 */

export type ShareReadinessRow = {
  id: string;
  audio_name: string;
  project_id: string | null;
  audio_url: string | null;
  deleted_at: string | null;
};

export type ShareReadinessItem = {
  id: string;
  audioName: string;
  projectId: string;
};

export type ShareReadiness = {
  missingAudioCount: number;
  items: ShareReadinessItem[];
};

/**
 * Re-validates `deleted_at is null and audio_url is null` on top of whatever the caller's query
 * already filtered — belt-and-suspenders so a future change to the route's query can't silently
 * change what counts as "missing" without this function's tests catching it. Rows with
 * `project_id === null` are excluded: a note with no project can never be "missing from a shared
 * project" (design §3.1 ADR-14 only ever queries notes joined to a project in the first place).
 */
export function computeShareReadiness(rows: ShareReadinessRow[]): ShareReadiness {
  const items = rows
    .filter((r) => r.deleted_at === null && !r.audio_url && r.project_id !== null)
    .map((r) => ({ id: r.id, audioName: r.audio_name, projectId: r.project_id as string }));

  return { missingAudioCount: items.length, items };
}
