import { describe, it, expect } from "vitest";
import { resolvePushOutcome, isClientVersionAllowed, MIN_SYNC_CLIENT_VERSION } from "./pushConflict";

describe("resolvePushOutcome", () => {
  it("fila nueva (isNewRow) siempre es ok, sin importar base_version", () => {
    expect(resolvePushOutcome(null, null, true)).toEqual({ status: "ok" });
    expect(resolvePushOutcome(null, 5, true)).toEqual({ status: "ok" });
  });

  it("fila existente con base_version igual a la version actual: ok", () => {
    expect(resolvePushOutcome(8, 8, false)).toEqual({ status: "ok" });
  });

  it("fila existente con base_version desactualizado: conflict, con la version del servidor (el server gana)", () => {
    expect(resolvePushOutcome(11, 9, false)).toEqual({ status: "conflict", version: 11 });
  });

  it("fila existente sin base_version: error client_too_old (backstop de contrato, ADR-07g)", () => {
    expect(resolvePushOutcome(11, null, false)).toEqual({ status: "error", code: "client_too_old" });
    expect(resolvePushOutcome(11, undefined, false)).toEqual({ status: "error", code: "client_too_old" });
  });
});

describe("isClientVersionAllowed", () => {
  it("header ausente: no permitido", () => {
    expect(isClientVersionAllowed(null, MIN_SYNC_CLIENT_VERSION)).toBe(false);
    expect(isClientVersionAllowed(undefined, MIN_SYNC_CLIENT_VERSION)).toBe(false);
  });

  it("header igual o mayor al mínimo: permitido", () => {
    expect(isClientVersionAllowed(MIN_SYNC_CLIENT_VERSION, MIN_SYNC_CLIENT_VERSION)).toBe(true);
    expect(isClientVersionAllowed("99.0.0", MIN_SYNC_CLIENT_VERSION)).toBe(true);
  });

  it("header menor al mínimo: rechazado", () => {
    expect(isClientVersionAllowed("0.1.0", "2.0.0")).toBe(false);
    expect(isClientVersionAllowed("1.9.9", "2.0.0")).toBe(false);
  });

  it("header con formato inválido: rechazado, no lanza", () => {
    expect(isClientVersionAllowed("no-es-una-version", MIN_SYNC_CLIENT_VERSION)).toBe(false);
  });
});
