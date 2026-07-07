import { describe, it, expect } from "vitest";
import { cutoffDateIso } from "./purge";

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
