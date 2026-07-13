import { describe, it, expect } from "vitest";
import { formatRelativeTime, isResurfaceEligible, pickResurfaceCandidate, RESURFACE_MIN_AGE_DAYS } from "./resurface";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-13T12:00:00.000Z").getTime();

function daysAgoIso(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe("formatRelativeTime", () => {
  it("devuelve 'hoy' para algo creado en las últimas 24hs", () => {
    expect(formatRelativeTime(daysAgoIso(0), NOW)).toBe("hoy");
  });

  it("singular para 1 día", () => {
    expect(formatRelativeTime(daysAgoIso(1), NOW)).toBe("hace 1 día");
  });

  it("plural para días (< 1 semana)", () => {
    expect(formatRelativeTime(daysAgoIso(3), NOW)).toBe("hace 3 días");
    expect(formatRelativeTime(daysAgoIso(6), NOW)).toBe("hace 6 días");
  });

  it("singular para 1 semana", () => {
    expect(formatRelativeTime(daysAgoIso(7), NOW)).toBe("hace 1 semana");
  });

  it("plural para semanas (< ~1 mes)", () => {
    expect(formatRelativeTime(daysAgoIso(21), NOW)).toBe("hace 3 semanas");
  });

  it("singular para 1 mes", () => {
    expect(formatRelativeTime(daysAgoIso(30), NOW)).toBe("hace 1 mes");
  });

  it("plural para meses (< 1 año)", () => {
    expect(formatRelativeTime(daysAgoIso(90), NOW)).toBe("hace 3 meses");
  });

  it("singular/plural para años", () => {
    expect(formatRelativeTime(daysAgoIso(365), NOW)).toBe("hace 1 año");
    expect(formatRelativeTime(daysAgoIso(800), NOW)).toBe("hace 2 años");
  });

  it("devuelve '' para un ISO inválido, sin lanzar", () => {
    expect(formatRelativeTime("no-es-una-fecha", NOW)).toBe("");
    expect(formatRelativeTime("", NOW)).toBe("");
  });

  it("nunca da un tiempo negativo si created_at está en el futuro (reloj desincronizado)", () => {
    expect(formatRelativeTime(new Date(NOW + DAY_MS).toISOString(), NOW)).toBe("hoy");
  });
});

describe("isResurfaceEligible", () => {
  it("false para algo más nuevo que el umbral", () => {
    expect(isResurfaceEligible(daysAgoIso(RESURFACE_MIN_AGE_DAYS - 1), NOW)).toBe(false);
  });

  it("true justo en el umbral y más viejo", () => {
    expect(isResurfaceEligible(daysAgoIso(RESURFACE_MIN_AGE_DAYS), NOW)).toBe(true);
    expect(isResurfaceEligible(daysAgoIso(RESURFACE_MIN_AGE_DAYS + 10), NOW)).toBe(true);
  });

  it("false para un ISO inválido, sin lanzar", () => {
    expect(isResurfaceEligible("no-es-una-fecha", NOW)).toBe(false);
  });
});

describe("pickResurfaceCandidate", () => {
  const oldest = { id: "a", created_at: daysAgoIso(60) };
  const middle = { id: "b", created_at: daysAgoIso(40) };
  const newest = { id: "c", created_at: daysAgoIso(20) };

  it("elige la más vieja del lote", () => {
    expect(pickResurfaceCandidate([middle, oldest, newest])?.id).toBe("a");
  });

  it("null si la lista está vacía", () => {
    expect(pickResurfaceCandidate([])).toBeNull();
  });

  it("salta las descartadas (excludeIds) y elige la siguiente más vieja", () => {
    expect(pickResurfaceCandidate([oldest, middle, newest], new Set(["a"]))?.id).toBe("b");
  });

  it("null si TODAS las candidatas están descartadas", () => {
    expect(pickResurfaceCandidate([oldest, middle], new Set(["a", "b"]))).toBeNull();
  });

  it("acepta excludeIds como array además de Set", () => {
    expect(pickResurfaceCandidate([oldest, middle, newest], ["a", "b"])?.id).toBe("c");
  });

  it("no rompe si la lista tiene un solo elemento", () => {
    expect(pickResurfaceCandidate([newest])?.id).toBe("c");
  });
});
