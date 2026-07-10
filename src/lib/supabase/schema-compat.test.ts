import { describe, it, expect, beforeEach } from "vitest";
import {
  isMissingColumnError,
  isMissingTableError,
  buildProjectRow,
  shouldRedetectSchemaCompat,
  markSchemaCompatResult,
  resetSchemaCompatCacheForTests,
  SCHEMA_COMPAT_CACHE_TTL_MS,
  getProjectColorCompatSnapshot,
  shouldRedetectProjectColorCompat,
  markProjectColorCompatResult,
  resetProjectColorCompatCacheForTests,
} from "./schema-compat";

describe("isMissingColumnError", () => {
  it("detecta código 42703 (columna inexistente)", () => {
    expect(isMissingColumnError({ code: "42703", message: "column projects.parent_project_id does not exist" })).toBe(
      true
    );
  });

  it("no matchea otro código 42xxx (ej. violación de unicidad 23505)", () => {
    expect(isMissingColumnError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      false
    );
  });

  it("no matchea tabla inexistente (42P01), aunque el código empiece con 42", () => {
    expect(isMissingColumnError({ code: "42P01", message: 'relation "drive_folders" does not exist' })).toBe(false);
  });

  it("cae a matchear por mensaje cuando no viene el código", () => {
    expect(isMissingColumnError({ message: 'column "parent_project_id" of relation "projects" does not exist' })).toBe(
      true
    );
    expect(isMissingColumnError({ message: "column projects.sync_origin does not exist" })).toBe(true);
  });

  it("no matchea un mensaje de 'does not exist' que no hable de una columna", () => {
    expect(isMissingColumnError({ message: 'relation "drive_folders" does not exist' })).toBe(false);
    expect(isMissingColumnError({ message: 'function foo() does not exist' })).toBe(false);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
    expect(isMissingColumnError("column does not exist")).toBe(false);
    expect(isMissingColumnError(42)).toBe(false);
    expect(isMissingColumnError({})).toBe(false);
    expect(isMissingColumnError({ code: 42703 })).toBe(false); // code no-string: no matchea
  });
});

describe("isMissingTableError", () => {
  it("detecta código 42P01 (relación/tabla inexistente)", () => {
    expect(isMissingTableError({ code: "42P01", message: 'relation "ai_usage_log" does not exist' })).toBe(true);
  });

  it("no matchea otro código 42xxx (ej. columna inexistente 42703)", () => {
    expect(isMissingTableError({ code: "42703", message: "column projects.color does not exist" })).toBe(false);
  });

  it("cae a matchear por mensaje cuando no viene el código", () => {
    expect(isMissingTableError({ message: 'relation "public.ai_usage_log" does not exist' })).toBe(true);
  });

  it("no matchea un mensaje de 'does not exist' que no hable de una relación", () => {
    expect(isMissingTableError({ message: "column projects.color does not exist" })).toBe(false);
    expect(isMissingTableError({ message: "function foo() does not exist" })).toBe(false);
  });

  it("NO se confunde con un mensaje de columna faltante que igual menciona 'relation' (regresión re-juicio)", () => {
    // El mensaje real de 42703 de Postgres contiene "relation" y "does not exist" — no debe
    // clasificarse como tabla faltante (el fallback por mensaje excluye los que mencionan "column").
    const columnMsg = 'column "summary" of relation "transcriptions" does not exist';
    expect(isMissingTableError({ message: columnMsg })).toBe(false);
    // Simetría: ese mismo mensaje SÍ es columna faltante.
    expect(isMissingColumnError({ message: columnMsg })).toBe(true);
  });

  it("devuelve false sin lanzar ante error null/undefined/con forma inesperada", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError("relation does not exist")).toBe(false);
    expect(isMissingTableError({})).toBe(false);
    expect(isMissingTableError({ code: 42701 })).toBe(false); // code no-string: no matchea
  });
});

describe("buildProjectRow", () => {
  const base = { id: "p1", user_id: "u1", name: "Proyecto", title: "Proyecto", deleted_at: null };

  it("con columnas disponibles: incluye parent_project_id y sync_origin", () => {
    const row = buildProjectRow(base, { parent_project_id: "root", sync_origin: "drive" }, true);
    expect(row).toEqual({ ...base, parent_project_id: "root", sync_origin: "drive" });
  });

  it("sin columnas disponibles: NO agrega esas claves al objeto final", () => {
    const row = buildProjectRow(base, { parent_project_id: "root", sync_origin: "drive" }, false);
    expect(row).toEqual(base);
    expect(Object.prototype.hasOwnProperty.call(row, "parent_project_id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, "sync_origin")).toBe(false);
  });

  it("con columnas disponibles pero un valor undefined en extra: no agrega esa clave puntual (no tocar el campo)", () => {
    const row = buildProjectRow(base, { parent_project_id: undefined, sync_origin: "local" }, true);
    expect(row).toEqual({ ...base, sync_origin: "local" });
    expect(Object.prototype.hasOwnProperty.call(row, "parent_project_id")).toBe(false);
  });

  it("con columnas disponibles y valor null explícito: SÍ agrega la clave (desenganchar de padre)", () => {
    const row = buildProjectRow(base, { parent_project_id: null }, true);
    expect(row).toEqual({ ...base, parent_project_id: null });
  });
});

describe("shouldRedetectSchemaCompat / markSchemaCompatResult (TTL)", () => {
  beforeEach(() => {
    resetSchemaCompatCacheForTests();
  });

  it("sin detección previa, siempre conviene detectar", () => {
    expect(shouldRedetectSchemaCompat(1_000)).toBe(true);
  });

  it("un cache reciente con available=true NO fuerza re-detección", () => {
    markSchemaCompatResult(true, 1_000);
    expect(shouldRedetectSchemaCompat(1_000 + SCHEMA_COMPAT_CACHE_TTL_MS - 1)).toBe(false);
  });

  it("un cache reciente con available=false NO fuerza re-detección", () => {
    markSchemaCompatResult(false, 1_000);
    expect(shouldRedetectSchemaCompat(1_000 + 500)).toBe(false);
  });

  it("un cache vencido (TTL superado) SÍ fuerza re-detección", () => {
    markSchemaCompatResult(true, 1_000);
    expect(shouldRedetectSchemaCompat(1_000 + SCHEMA_COMPAT_CACHE_TTL_MS + 1)).toBe(true);
  });

  it("justo en el borde del TTL todavía no fuerza re-detección (comparación estricta '>')", () => {
    markSchemaCompatResult(true, 1_000);
    expect(shouldRedetectSchemaCompat(1_000 + SCHEMA_COMPAT_CACHE_TTL_MS)).toBe(false);
  });
});

describe("cache de compat de projects.color (F2) es INDEPENDIENTE del de Drive-sync v2", () => {
  beforeEach(() => {
    resetSchemaCompatCacheForTests();
    resetProjectColorCompatCacheForTests();
  });

  it("arranca sin detección todavía, igual que el otro cache", () => {
    expect(getProjectColorCompatSnapshot()).toEqual({ available: null, checkedAt: 0 });
    expect(shouldRedetectProjectColorCompat(1_000)).toBe(true);
  });

  it("marcar el cache de color no afecta al cache de Drive-sync v2, y viceversa", () => {
    markProjectColorCompatResult(false, 1_000);
    markSchemaCompatResult(true, 1_000);

    expect(getProjectColorCompatSnapshot()).toEqual({ available: false, checkedAt: 1_000 });
    expect(shouldRedetectSchemaCompat(1_000 + 500)).toBe(false);
    // Color sigue "no disponible" y dentro del TTL, sin importar que Drive-sync v2 esté OK.
    expect(shouldRedetectProjectColorCompat(1_000 + 500)).toBe(false);
  });

  it("respeta el mismo TTL que el cache de Drive-sync v2", () => {
    markProjectColorCompatResult(true, 1_000);
    expect(shouldRedetectProjectColorCompat(1_000 + SCHEMA_COMPAT_CACHE_TTL_MS + 1)).toBe(true);
  });
});
