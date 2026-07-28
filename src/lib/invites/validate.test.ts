import { describe, it, expect } from "vitest";
import { isValidInviteRole, sanitizeEmail } from "./validate";

describe("isValidInviteRole", () => {
  it.each(["admin", "editor", "viewer"])("accepts %s", (role) => {
    expect(isValidInviteRole(role)).toBe(true);
  });

  it("rejects 'owner' — it is materialized automatically, never invited", () => {
    expect(isValidInviteRole("owner")).toBe(false);
  });

  it("rejects unknown strings, non-strings, and empty input", () => {
    expect(isValidInviteRole("superadmin")).toBe(false);
    expect(isValidInviteRole(null)).toBe(false);
    expect(isValidInviteRole(undefined)).toBe(false);
    expect(isValidInviteRole(42)).toBe(false);
    expect(isValidInviteRole("")).toBe(false);
  });
});

describe("sanitizeEmail", () => {
  it("trims and lowercases a valid email", () => {
    expect(sanitizeEmail("  Someone@Example.com  ")).toBe("someone@example.com");
  });

  it("rejects malformed shapes", () => {
    expect(sanitizeEmail("not-an-email")).toBeNull();
    expect(sanitizeEmail("missing-domain@")).toBeNull();
    expect(sanitizeEmail("@missing-local.com")).toBeNull();
    expect(sanitizeEmail("has spaces@example.com")).toBeNull();
  });

  it("rejects non-string, empty, and overlong input", () => {
    expect(sanitizeEmail(null)).toBeNull();
    expect(sanitizeEmail(undefined)).toBeNull();
    expect(sanitizeEmail(42)).toBeNull();
    expect(sanitizeEmail("   ")).toBeNull();
    expect(sanitizeEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});
