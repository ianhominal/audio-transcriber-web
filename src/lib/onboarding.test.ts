import { describe, it, expect } from "vitest";
import { shouldShowOnboarding, ONBOARDING_SEEN_KEY } from "./onboarding";

describe("shouldShowOnboarding", () => {
  it("false when the account already has notes and onboarding was seen", () => {
    expect(shouldShowOnboarding({ hasAnyNotes: true, seen: true })).toBe(false);
  });

  it("false when the account already has notes, even if onboarding was never seen", () => {
    expect(shouldShowOnboarding({ hasAnyNotes: true, seen: false })).toBe(false);
  });

  it("false when the account has zero notes but onboarding was already seen/dismissed", () => {
    expect(shouldShowOnboarding({ hasAnyNotes: false, seen: true })).toBe(false);
  });

  it("true only when the account has zero notes AND onboarding was never seen", () => {
    expect(shouldShowOnboarding({ hasAnyNotes: false, seen: false })).toBe(true);
  });

  it("is a pure function: no side effects, same input always yields same output", () => {
    const params = { hasAnyNotes: false, seen: false };
    expect(shouldShowOnboarding(params)).toBe(shouldShowOnboarding(params));
  });

  it("exports the localStorage key used by the client component as a stable constant", () => {
    expect(ONBOARDING_SEEN_KEY).toBe("onboarding-seen");
  });
});
