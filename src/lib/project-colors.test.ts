import { describe, it, expect } from "vitest";
import {
  PROJECT_COLOR_IDS,
  PROJECT_COLORS,
  isProjectColorId,
  resolveProjectColorId,
  getProjectColor,
} from "./project-colors";

describe("PROJECT_COLOR_IDS / PROJECT_COLORS", () => {
  it("tiene exactamente 12 ids, todos únicos", () => {
    expect(PROJECT_COLOR_IDS).toHaveLength(12);
    expect(new Set(PROJECT_COLOR_IDS).size).toBe(12);
  });

  it("PROJECT_COLORS tiene una entrada por cada id, en el mismo orden", () => {
    expect(PROJECT_COLORS.map((c) => c.id)).toEqual([...PROJECT_COLOR_IDS]);
  });

  it("cada entrada tiene label, dot, border y badge no vacíos", () => {
    for (const c of PROJECT_COLORS) {
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.dot.trim().length).toBeGreaterThan(0);
      expect(c.border.trim().length).toBeGreaterThan(0);
      expect(c.badge.trim().length).toBeGreaterThan(0);
    }
  });

  it("pink y rose tienen labels distintos entre sí (evita ambigüedad en el picker)", () => {
    const pink = PROJECT_COLORS.find((c) => c.id === "pink");
    const rose = PROJECT_COLORS.find((c) => c.id === "rose");
    expect(pink?.label).not.toBe(rose?.label);
  });

  it("dot y border usan el mismo peso de color (600 light / 400 dark) para cada familia", () => {
    for (const c of PROJECT_COLORS) {
      expect(c.dot).toBe(`bg-${c.id}-600 dark:bg-${c.id}-400`);
      expect(c.border).toBe(`border-${c.id}-600 dark:border-${c.id}-400`);
    }
  });

  it("badge sigue el ratio 50/700 light y 400@18%/200 dark para cada familia", () => {
    for (const c of PROJECT_COLORS) {
      expect(c.badge).toBe(`bg-${c.id}-50 text-${c.id}-700 dark:bg-${c.id}-400/18 dark:text-${c.id}-200`);
    }
  });
});

describe("isProjectColorId", () => {
  it("acepta los 12 ids válidos", () => {
    for (const id of PROJECT_COLOR_IDS) {
      expect(isProjectColorId(id)).toBe(true);
    }
  });

  it("rechaza ids desconocidos, valores no-string y null/undefined", () => {
    expect(isProjectColorId("magenta")).toBe(false);
    expect(isProjectColorId("")).toBe(false);
    expect(isProjectColorId(null)).toBe(false);
    expect(isProjectColorId(undefined)).toBe(false);
    expect(isProjectColorId(42)).toBe(false);
  });
});

describe("resolveProjectColorId", () => {
  it("devuelve el id tal cual si es válido", () => {
    expect(resolveProjectColorId("indigo")).toBe("indigo");
  });

  it("cae a null (neutro) ante cualquier valor inválido, nunca a un color por default", () => {
    expect(resolveProjectColorId("no-existe")).toBeNull();
    expect(resolveProjectColorId(null)).toBeNull();
    expect(resolveProjectColorId(undefined)).toBeNull();
    expect(resolveProjectColorId("")).toBeNull();
    expect(resolveProjectColorId(123)).toBeNull();
  });
});

describe("getProjectColor", () => {
  it("devuelve la definición completa para un id válido", () => {
    const def = getProjectColor("teal");
    expect(def).not.toBeNull();
    expect(def?.label).toBe("Turquesa");
  });

  it("devuelve null para null/undefined (proyecto sin color/neutro), sin lanzar", () => {
    expect(getProjectColor(null)).toBeNull();
    expect(getProjectColor(undefined)).toBeNull();
  });

  it("devuelve null gracefully para un id desconocido, sin lanzar", () => {
    expect(getProjectColor("no-existe")).toBeNull();
    expect(getProjectColor("")).toBeNull();
  });
});
