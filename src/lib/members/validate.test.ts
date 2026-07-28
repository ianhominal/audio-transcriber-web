import { describe, it, expect } from "vitest";
import { resolveRoleChangeError, resolveRemovalError } from "./validate";

describe("resolveRoleChangeError", () => {
  it("rejects changing the owner's role", () => {
    expect(resolveRoleChangeError({ currentRole: "owner", isSelf: false, newRole: "admin" })).toBe(
      "No se puede cambiar el rol del dueño del proyecto."
    );
  });

  it("rejects self-promotion to a higher rank", () => {
    expect(resolveRoleChangeError({ currentRole: "viewer", isSelf: true, newRole: "admin" })).toBe(
      "No podés subirte el rol a vos mismo."
    );
    expect(resolveRoleChangeError({ currentRole: "editor", isSelf: true, newRole: "admin" })).toBe(
      "No podés subirte el rol a vos mismo."
    );
  });

  it("allows self-demotion to a lower rank", () => {
    expect(resolveRoleChangeError({ currentRole: "admin", isSelf: true, newRole: "editor" })).toBeNull();
  });

  it("allows changing someone else's role, up or down", () => {
    expect(resolveRoleChangeError({ currentRole: "viewer", isSelf: false, newRole: "admin" })).toBeNull();
    expect(resolveRoleChangeError({ currentRole: "admin", isSelf: false, newRole: "viewer" })).toBeNull();
  });
});

describe("resolveRemovalError", () => {
  it("rejects removing the owner", () => {
    expect(resolveRemovalError("owner")).toBe("No se puede quitar al dueño del proyecto.");
  });

  it("allows removing anyone else, including yourself", () => {
    expect(resolveRemovalError("admin")).toBeNull();
    expect(resolveRemovalError("editor")).toBeNull();
    expect(resolveRemovalError("viewer")).toBeNull();
  });
});
