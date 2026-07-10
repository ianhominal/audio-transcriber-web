import { describe, it, expect } from "vitest";
import { cutoffDateIso, audioPathsToRemove, selectPurgeableTranscriptionIds } from "./purge";

describe("cutoffDateIso", () => {
  it("calcula la fecha N días antes de `now`", () => {
    const now = new Date("2026-07-31T00:00:00.000Z");
    expect(cutoffDateIso(30, now)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("con 0 días devuelve `now` sin cambios", () => {
    const now = new Date("2026-07-31T00:00:00.000Z");
    expect(cutoffDateIso(0, now)).toBe(now.toISOString());
  });
});

describe("audioPathsToRemove", () => {
  it("devuelve solo los audio_url no-null", () => {
    const expired = [
      { id: "a", audio_url: "u1/x.webm" },
      { id: "b", audio_url: null },
      { id: "c", audio_url: "u1/y.webm" },
    ];
    expect(audioPathsToRemove(expired)).toEqual(["u1/x.webm", "u1/y.webm"]);
  });

  it("lista vacía si ninguna fila tiene audio", () => {
    expect(audioPathsToRemove([{ id: "a", audio_url: null }])).toEqual([]);
  });
});

describe("selectPurgeableTranscriptionIds", () => {
  const mixed = [
    { id: "no-audio-1", audio_url: null },
    { id: "with-audio-1", audio_url: "u1/x.webm" },
    { id: "with-audio-2", audio_url: "u1/y.webm" },
  ];

  it("Storage OK: TODAS las filas vencidas son purgables (incluidas las de audio ya borrado)", () => {
    expect(selectPurgeableTranscriptionIds(mixed, true).sort()).toEqual(
      ["no-audio-1", "with-audio-1", "with-audio-2"].sort()
    );
  });

  it("Storage FALLÓ: solo se purgan las filas SIN audio; las de audio quedan para reintentar", () => {
    expect(selectPurgeableTranscriptionIds(mixed, false)).toEqual(["no-audio-1"]);
  });

  it("todas sin audio + Storage OK: todas purgables", () => {
    const noAudio = [
      { id: "a", audio_url: null },
      { id: "b", audio_url: null },
    ];
    expect(selectPurgeableTranscriptionIds(noAudio, true)).toEqual(["a", "b"]);
  });

  it("todas con audio + Storage FALLÓ: ninguna purgable (todas se reintentan)", () => {
    const allAudio = [
      { id: "a", audio_url: "u/a.webm" },
      { id: "b", audio_url: "u/b.webm" },
    ];
    expect(selectPurgeableTranscriptionIds(allAudio, false)).toEqual([]);
  });

  it("lista vacía → sin ids en ambos casos", () => {
    expect(selectPurgeableTranscriptionIds([], true)).toEqual([]);
    expect(selectPurgeableTranscriptionIds([], false)).toEqual([]);
  });
});
