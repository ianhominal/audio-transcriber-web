import { describe, it, expect } from "vitest";
import {
  buildProjectTree,
  planDriveImport,
  type ProjectTreeInput,
  type DriveTreeNode,
} from "./tree";

describe("buildProjectTree", () => {
  it("proyectos locales planos (sin padre) quedan todos como raíces, en el mismo orden", () => {
    const projects: ProjectTreeInput[] = [
      { id: "p1", name: "Uno", icon: "📁", parentProjectId: null, syncOrigin: "local" },
      { id: "p2", name: "Dos", icon: "📁", parentProjectId: null, syncOrigin: "local" },
    ];
    const tree = buildProjectTree(projects);
    expect(tree.map((n) => n.id)).toEqual(["p1", "p2"]);
    expect(tree[0].children).toEqual([]);
    expect(tree[1].children).toEqual([]);
  });

  it("arma un árbol de Drive de 3 niveles (raíz → hijo → nieto)", () => {
    const projects: ProjectTreeInput[] = [
      { id: "root", name: "Reuniones", icon: "", parentProjectId: null, syncOrigin: "drive" },
      { id: "child", name: "Semana 1", icon: "", parentProjectId: "root", syncOrigin: "drive" },
      { id: "grandchild", name: "Lunes", icon: "", parentProjectId: "child", syncOrigin: "drive" },
      { id: "normal", name: "Personal", icon: "📁", parentProjectId: null, syncOrigin: "local" },
    ];
    const tree = buildProjectTree(projects);
    expect(tree.map((n) => n.id).sort()).toEqual(["normal", "root"].sort());

    const root = tree.find((n) => n.id === "root")!;
    expect(root.children.map((n) => n.id)).toEqual(["child"]);
    expect(root.children[0].children.map((n) => n.id)).toEqual(["grandchild"]);
    expect(root.children[0].children[0].children).toEqual([]);
  });

  it("un parent_project_id que apunta a un id inexistente cae como raíz (huérfano defensivo)", () => {
    const projects: ProjectTreeInput[] = [
      { id: "orphan", name: "Huérfano", icon: "", parentProjectId: "no-existe", syncOrigin: "drive" },
    ];
    const tree = buildProjectTree(projects);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("un proyecto que se apunta a sí mismo como padre cae como raíz (no se auto-anida)", () => {
    const projects: ProjectTreeInput[] = [
      { id: "self", name: "Self", icon: "", parentProjectId: "self", syncOrigin: "drive" },
    ];
    const tree = buildProjectTree(projects);
    expect(tree.map((n) => n.id)).toEqual(["self"]);
    expect(tree[0].children).toEqual([]);
  });

  it("no explota ante un ciclo corrupto (A→B→A): ninguno queda huérfano visible, pero tampoco cuelga", () => {
    const projects: ProjectTreeInput[] = [
      { id: "a", name: "A", icon: "", parentProjectId: "b", syncOrigin: "drive" },
      { id: "b", name: "B", icon: "", parentProjectId: "a", syncOrigin: "drive" },
    ];
    const tree = buildProjectTree(projects);
    expect(tree).toEqual([]);
  });
});

describe("planDriveImport", () => {
  function folder(driveId: string, name: string, children: DriveTreeNode[] = []): DriveTreeNode {
    return { driveId, name, isFolder: true, children };
  }
  function file(driveId: string, name: string): DriveTreeNode {
    return { driveId, name, isFolder: false };
  }

  it("planea un árbol de 2 niveles: subcarpeta + .md dentro de ella, con el padre correcto", () => {
    const root = folder("root", "Reuniones", [
      folder("sem1", "Semana 1", [file("f1", "lunes.md")]),
      file("f0", "bienvenida.md"),
    ]);

    const plan = planDriveImport(root);

    expect(plan.projectsToCreate).toEqual([{ driveFolderId: "sem1", name: "Semana 1", parentDriveFolderId: "root" }]);
    expect(plan.transcriptionsToCreate).toEqual(
      expect.arrayContaining([
        { driveFileId: "f1", name: "lunes.md", parentDriveFolderId: "sem1" },
        { driveFileId: "f0", name: "bienvenida.md", parentDriveFolderId: "root" },
      ])
    );
    expect(plan.transcriptionsToCreate).toHaveLength(2);
    expect(plan.skippedOtherFiles).toBe(0);
    expect(plan.depthTruncated).toBe(false);
  });

  it("planea un árbol de 3 niveles (raíz → hijo → nieto) en orden padre-primero", () => {
    const root = folder("root", "Clases", [
      folder("mate", "Matemática", [folder("mate-u1", "Unidad 1", [file("f2", "clase1.md")])]),
    ]);

    const plan = planDriveImport(root);

    expect(plan.projectsToCreate.map((s) => s.driveFolderId)).toEqual(["mate", "mate-u1"]);
    expect(plan.projectsToCreate[1].parentDriveFolderId).toBe("mate");
    expect(plan.transcriptionsToCreate).toEqual([
      { driveFileId: "f2", name: "clase1.md", parentDriveFolderId: "mate-u1" },
    ]);
  });

  it("ignora archivos que no son carpeta ni .md (audio, PDF, etc.)", () => {
    const root = folder("root", "Reuniones", [file("a1", "audio.m4a"), file("p1", "notas.pdf")]);
    const plan = planDriveImport(root);
    expect(plan.projectsToCreate).toEqual([]);
    expect(plan.transcriptionsToCreate).toEqual([]);
    expect(plan.skippedOtherFiles).toBe(2);
  });

  it("idempotencia: carpetas/archivos ya mapeados no se re-planean, pero SÍ se desciende dentro de carpetas existentes", () => {
    const root = folder("root", "Reuniones", [
      folder("sem1", "Semana 1", [file("f1", "lunes.md"), file("f2", "nuevo.md")]),
    ]);

    const plan = planDriveImport(root, {
      existingFolderIds: new Set(["sem1"]),
      existingFileIds: new Set(["f1"]),
    });

    // sem1 ya existía: no se re-crea el proyecto, pero se descubre f2 (nuevo) dentro.
    expect(plan.projectsToCreate).toEqual([]);
    expect(plan.skippedExistingFolders).toBe(1);
    expect(plan.transcriptionsToCreate).toEqual([{ driveFileId: "f2", name: "nuevo.md", parentDriveFolderId: "sem1" }]);
    expect(plan.skippedExistingFiles).toBe(1);
  });

  it("reconexión completa (todo ya mapeado) no planea nada nuevo", () => {
    const root = folder("root", "Reuniones", [folder("sem1", "Semana 1", [file("f1", "lunes.md")])]);
    const plan = planDriveImport(root, {
      existingFolderIds: new Set(["sem1"]),
      existingFileIds: new Set(["f1"]),
    });
    expect(plan.projectsToCreate).toEqual([]);
    expect(plan.transcriptionsToCreate).toEqual([]);
    expect(plan.skippedExistingFolders).toBe(1);
    expect(plan.skippedExistingFiles).toBe(1);
  });

  it("no explota ante un ciclo corrupto (una carpeta se referencia a sí misma como hija)", () => {
    const cyclic: DriveTreeNode = { driveId: "loop", name: "Loop", isFolder: true, children: [] };
    cyclic.children!.push(cyclic);
    const root = folder("root", "Reuniones", [cyclic]);

    const plan = planDriveImport(root);
    expect(plan.projectsToCreate.map((s) => s.driveFolderId)).toEqual(["loop"]);
  });

  it("respeta maxDepth y marca depthTruncated cuando el árbol es más profundo", () => {
    // 3 niveles reales: root → n1 → n2 (con hijo n3 que quedaría fuera con maxDepth=2)
    const n3 = folder("n3", "Nivel 3", [file("f3", "nota.md")]);
    const n2 = folder("n2", "Nivel 2", [n3]);
    const n1 = folder("n1", "Nivel 1", [n2]);
    const root = folder("root", "Raíz", [n1]);

    const plan = planDriveImport(root, { maxDepth: 2 });

    // n1 (depth 1→2 al crearlo) y n2 sí se crean; al llegar a n2 con depth=3 se corta antes de entrar.
    expect(plan.projectsToCreate.map((s) => s.driveFolderId)).toEqual(["n1", "n2"]);
    expect(plan.depthTruncated).toBe(true);
  });
});
