import { describe, it, expect } from "vitest";
import {
  encodeTranscriptionDragPayload,
  decodeTranscriptionDragPayload,
  resolveTranscriptionDrop,
} from "./transcriptionDrag";

describe("encodeTranscriptionDragPayload / decodeTranscriptionDragPayload", () => {
  it("hace round-trip con projectId string", () => {
    const raw = encodeTranscriptionDragPayload({ id: "t1", projectId: "p1" });
    expect(decodeTranscriptionDragPayload(raw)).toEqual({ id: "t1", projectId: "p1" });
  });

  it("hace round-trip con projectId null (sin proyecto)", () => {
    const raw = encodeTranscriptionDragPayload({ id: "t1", projectId: null });
    expect(decodeTranscriptionDragPayload(raw)).toEqual({ id: "t1", projectId: null });
  });

  it("devuelve null para string vacío", () => {
    expect(decodeTranscriptionDragPayload("")).toBeNull();
  });

  it("devuelve null para JSON inválido (drag externo, no es nuestro payload)", () => {
    expect(decodeTranscriptionDragPayload("no es json")).toBeNull();
  });

  it("devuelve null si falta el id", () => {
    expect(decodeTranscriptionDragPayload(JSON.stringify({ projectId: "p1" }))).toBeNull();
  });

  it("devuelve null si id no es string", () => {
    expect(decodeTranscriptionDragPayload(JSON.stringify({ id: 123, projectId: null }))).toBeNull();
  });

  it("devuelve null si projectId no es string ni null", () => {
    expect(decodeTranscriptionDragPayload(JSON.stringify({ id: "t1", projectId: 5 }))).toBeNull();
  });

  it("devuelve null si el JSON no es un objeto", () => {
    expect(decodeTranscriptionDragPayload(JSON.stringify("t1"))).toBeNull();
    expect(decodeTranscriptionDragPayload(JSON.stringify(null))).toBeNull();
  });
});

describe("resolveTranscriptionDrop", () => {
  const knownProjectIds = ["p1", "p2"];

  it("mueve a un proyecto válido distinto del actual", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: "p1" }, "p2", knownProjectIds);
    expect(res).toEqual({ shouldMove: true, id: "t1", projectId: "p2" });
  });

  it("desasigna (target null) cuando la transcripción tenía proyecto", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: "p1" }, null, knownProjectIds);
    expect(res).toEqual({ shouldMove: true, id: "t1", projectId: null });
  });

  it("es no-op si se suelta sobre el mismo proyecto que ya tiene", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: "p1" }, "p1", knownProjectIds);
    expect(res).toEqual({ shouldMove: false, reason: "same-project" });
  });

  it("es no-op si ya está sin proyecto y se suelta sobre 'Sin proyecto'", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: null }, null, knownProjectIds);
    expect(res).toEqual({ shouldMove: false, reason: "same-project" });
  });

  it("rechaza un proyecto destino que no está en knownProjectIds", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: "p1" }, "otro-de-otro-usuario", knownProjectIds);
    expect(res).toEqual({ shouldMove: false, reason: "invalid-target" });
  });

  it("no valida knownProjectIds cuando el destino es 'Sin proyecto' (null)", () => {
    const res = resolveTranscriptionDrop({ id: "t1", projectId: "p1" }, null, []);
    expect(res).toEqual({ shouldMove: true, id: "t1", projectId: null });
  });
});
