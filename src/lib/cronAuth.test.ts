import { describe, it, expect } from "vitest";
import { isAuthorizedCronSecret, bearerSecretFromHeader } from "./cronAuth";

describe("isAuthorizedCronSecret", () => {
  it("autoriza con el secreto correcto en el header", () => {
    expect(isAuthorizedCronSecret("shh", null, "shh")).toBe(true);
  });

  it("autoriza con el secreto correcto en la query", () => {
    expect(isAuthorizedCronSecret(null, "shh", "shh")).toBe(true);
  });

  it("rechaza secreto incorrecto", () => {
    expect(isAuthorizedCronSecret("otro", null, "shh")).toBe(false);
    expect(isAuthorizedCronSecret(null, "otro", "shh")).toBe(false);
  });

  it("rechaza si no hay CRON_SECRET configurado (fail-closed)", () => {
    expect(isAuthorizedCronSecret("shh", null, undefined)).toBe(false);
    expect(isAuthorizedCronSecret("shh", "shh", "")).toBe(false);
  });

  it("rechaza si no se manda ningún secreto", () => {
    expect(isAuthorizedCronSecret(null, null, "shh")).toBe(false);
  });

  it("tolera longitudes distintas sin lanzar", () => {
    expect(isAuthorizedCronSecret("corto", null, "un-secreto-mucho-mas-largo")).toBe(false);
  });
});

describe("bearerSecretFromHeader", () => {
  it("extrae el secreto de 'Bearer <secreto>'", () => {
    expect(bearerSecretFromHeader("Bearer abc123")).toBe("abc123");
  });

  it("devuelve null si no tiene el prefijo Bearer", () => {
    expect(bearerSecretFromHeader("abc123")).toBeNull();
  });

  it("devuelve null si el header es null", () => {
    expect(bearerSecretFromHeader(null)).toBeNull();
  });
});
