import { describe, it, expect } from "vitest";
import { buildMergeRequestBody } from "./request";

describe("buildMergeRequestBody", () => {
  it("incluye los transcriptionIds del proyecto tal cual, en orden", () => {
    const body = buildMergeRequestBody(["t1", "t2", "t3"], "");
    expect(body.transcriptionIds).toEqual(["t1", "t2", "t3"]);
  });

  it("recorta espacios de la instrucción", () => {
    const body = buildMergeRequestBody(["t1", "t2"], "  armá un outline  ");
    expect(body.instruction).toBe("armá un outline");
  });

  it("instrucción vacía o solo espacios se manda como string vacío (equivalente a 'sin instrucción')", () => {
    expect(buildMergeRequestBody(["t1", "t2"], "").instruction).toBe("");
    expect(buildMergeRequestBody(["t1", "t2"], "   ").instruction).toBe("");
  });

  it("no muta el array de ids recibido", () => {
    const ids = ["t1", "t2"];
    buildMergeRequestBody(ids, "algo");
    expect(ids).toEqual(["t1", "t2"]);
  });
});
