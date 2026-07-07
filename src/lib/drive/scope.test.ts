import { describe, it, expect } from "vitest";
import { computeDriveScopeProjectIds, buildProjectDriveFolderMap, type ProjectLite } from "./scope";

describe("computeDriveScopeProjectIds", () => {
  it("incluye solo la raíz cuando no tiene hijos", () => {
    const projects: ProjectLite[] = [{ id: "root", parentProjectId: null }];
    const scope = computeDriveScopeProjectIds(projects, ["root"]);
    expect([...scope]).toEqual(["root"]);
  });

  it("incluye el subárbol completo de una raíz (hijos y nietos)", () => {
    const projects: ProjectLite[] = [
      { id: "root", parentProjectId: null },
      { id: "child1", parentProjectId: "root" },
      { id: "child2", parentProjectId: "root" },
      { id: "grandchild", parentProjectId: "child1" },
      { id: "otro-arbol", parentProjectId: null }, // proyecto normal, NO conectado a Drive
    ];
    const scope = computeDriveScopeProjectIds(projects, ["root"]);
    expect(scope.has("root")).toBe(true);
    expect(scope.has("child1")).toBe(true);
    expect(scope.has("child2")).toBe(true);
    expect(scope.has("grandchild")).toBe(true);
    expect(scope.has("otro-arbol")).toBe(false);
  });

  it("soporta varias raíces conectadas (varias drive_folders) sin mezclar árboles ajenos", () => {
    const projects: ProjectLite[] = [
      { id: "reuniones", parentProjectId: null },
      { id: "reuniones/semana1", parentProjectId: "reuniones" },
      { id: "clases", parentProjectId: null },
      { id: "clases/mate", parentProjectId: "clases" },
      { id: "proyecto-app-normal", parentProjectId: null },
    ];
    const scope = computeDriveScopeProjectIds(projects, ["reuniones", "clases"]);
    expect([...scope].sort()).toEqual(["clases", "clases/mate", "reuniones", "reuniones/semana1"].sort());
    expect(scope.has("proyecto-app-normal")).toBe(false);
  });

  it("no explota ante un ciclo corrupto (A→B→A) — cada id se visita una sola vez", () => {
    const projects: ProjectLite[] = [
      { id: "a", parentProjectId: "b" },
      { id: "b", parentProjectId: "a" },
    ];
    const scope = computeDriveScopeProjectIds(projects, ["a"]);
    expect([...scope].sort()).toEqual(["a", "b"]);
  });

  it("devuelve set vacío cuando no hay ninguna drive_folders conectada (el ACOTADO real)", () => {
    const projects: ProjectLite[] = [
      { id: "p1", parentProjectId: null },
      { id: "p2", parentProjectId: "p1" },
    ];
    const scope = computeDriveScopeProjectIds(projects, []);
    expect(scope.size).toBe(0);
  });
});

describe("buildProjectDriveFolderMap", () => {
  it("mapea la raíz a su propia carpeta de Drive", () => {
    const projects: ProjectLite[] = [{ id: "root", parentProjectId: null }];
    const map = buildProjectDriveFolderMap(projects, [{ driveFolderId: "drive-root-1", localProjectId: "root" }]);
    expect(map.get("root")).toBe("drive-root-1");
  });

  it("un nieto resuelve la carpeta de Drive de su raíz conectada (plano, sin subcarpetas aún)", () => {
    const projects: ProjectLite[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
      { id: "grandchild", parentProjectId: "child" },
    ];
    const map = buildProjectDriveFolderMap(projects, [{ driveFolderId: "drive-root-1", localProjectId: "root" }]);
    expect(map.get("child")).toBe("drive-root-1");
    expect(map.get("grandchild")).toBe("drive-root-1");
  });

  it("un proyecto fuera del árbol de Drive no aparece en el mapa", () => {
    const projects: ProjectLite[] = [
      { id: "root", parentProjectId: null },
      { id: "normal", parentProjectId: null },
    ];
    const map = buildProjectDriveFolderMap(projects, [{ driveFolderId: "drive-root-1", localProjectId: "root" }]);
    expect(map.has("normal")).toBe(false);
  });

  it("varias raíces resuelven a carpetas de Drive distintas", () => {
    const projects: ProjectLite[] = [
      { id: "reuniones", parentProjectId: null },
      { id: "reuniones/semana1", parentProjectId: "reuniones" },
      { id: "clases", parentProjectId: null },
    ];
    const map = buildProjectDriveFolderMap(projects, [
      { driveFolderId: "drive-reuniones", localProjectId: "reuniones" },
      { driveFolderId: "drive-clases", localProjectId: "clases" },
    ]);
    expect(map.get("reuniones/semana1")).toBe("drive-reuniones");
    expect(map.get("clases")).toBe("drive-clases");
  });

  it("no explota ante un ciclo corrupto: no resuelve carpeta (no hay raíz alcanzable) pero no cuelga", () => {
    const projects: ProjectLite[] = [
      { id: "a", parentProjectId: "b" },
      { id: "b", parentProjectId: "a" },
    ];
    const map = buildProjectDriveFolderMap(projects, []);
    expect(map.size).toBe(0);
  });
});
