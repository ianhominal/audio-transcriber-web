import { describe, it, expect } from "vitest";
import { computeShareReadiness, type ShareReadinessRow } from "./compute";

function row(overrides: Partial<ShareReadinessRow> = {}): ShareReadinessRow {
  return {
    id: "t1",
    audio_name: "nota.wav",
    project_id: "p1",
    audio_url: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("computeShareReadiness", () => {
  it("spec 'El owner ve las notas sin audio antes de compartir': 3 without audio_url → count 3 + detail", () => {
    const rows = [row({ id: "t1" }), row({ id: "t2" }), row({ id: "t3" })];
    const result = computeShareReadiness(rows);
    expect(result.missingAudioCount).toBe(3);
    expect(result.items.map((i) => i.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("spec 'Un proyecto con todo el audio en la nube reporta cero faltantes'", () => {
    const rows = [row({ audio_url: "u1/a.wav" }), row({ audio_url: "u1/b.wav" })];
    const result = computeShareReadiness(rows);
    expect(result).toEqual({ missingAudioCount: 0, items: [] });
  });

  it("excludes soft-deleted rows even if they have no audio_url", () => {
    const rows = [row({ deleted_at: "2026-01-01T00:00:00Z" })];
    expect(computeShareReadiness(rows).missingAudioCount).toBe(0);
  });

  it("excludes rows without a project (a note with no project can't be 'missing from sharing')", () => {
    const rows = [row({ project_id: null })];
    expect(computeShareReadiness(rows).missingAudioCount).toBe(0);
  });

  it("treats an empty string audio_url as missing (same convention as computeAudioState)", () => {
    const rows = [row({ audio_url: "" })];
    expect(computeShareReadiness(rows).missingAudioCount).toBe(1);
  });
});
