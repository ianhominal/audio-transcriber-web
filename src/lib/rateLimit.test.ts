import { describe, it, expect } from "vitest";
import { isOverDailyLimit } from "./rateLimit";

describe("isOverDailyLimit", () => {
  it("devuelve false si el conteo está por debajo del límite", () => {
    expect(isOverDailyLimit(0, 50)).toBe(false);
    expect(isOverDailyLimit(49, 50)).toBe(false);
  });

  it("devuelve true si el conteo alcanza o supera el límite", () => {
    expect(isOverDailyLimit(50, 50)).toBe(true);
    expect(isOverDailyLimit(51, 50)).toBe(true);
  });

  it("tolera límite 0 (bloquea todo)", () => {
    expect(isOverDailyLimit(0, 0)).toBe(true);
  });
});
