import { describe, it, expect } from "vitest";
import { buildProjectQuickActionMessage } from "./projectActions";

describe("buildProjectQuickActionMessage", () => {
  it("'summarize' devuelve el texto canned de resumen", () => {
    expect(buildProjectQuickActionMessage("summarize")).toBe("Resumí este proyecto en los puntos clave.");
  });

  it("'next-steps' devuelve el texto canned de próximos pasos", () => {
    expect(buildProjectQuickActionMessage("next-steps")).toBe(
      "¿Cuáles son los próximos pasos o pendientes según estas notas?"
    );
  });

  it("ambas acciones devuelven textos no vacíos y distintos entre sí", () => {
    const summarize = buildProjectQuickActionMessage("summarize");
    const nextSteps = buildProjectQuickActionMessage("next-steps");
    expect(summarize.trim().length).toBeGreaterThan(0);
    expect(nextSteps.trim().length).toBeGreaterThan(0);
    expect(summarize).not.toBe(nextSteps);
  });
});
