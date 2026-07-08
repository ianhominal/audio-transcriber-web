import { describe, it, expect } from "vitest";
import {
  buildProjectTree,
  planDriveImport,
  rollUpProjectCounts,
  collectProjectSubtreeIds,
  wouldCreateProjectCycle,
  planProjectDeletion,
  isProjectDeletionAuthorized,
  type ProjectTreeInput,
  type DriveTreeNode,
  type ProjectParentLink,
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

describe("rollUpProjectCounts", () => {
  it("un padre acumula su conteo directo + el de todos sus descendientes (árbol de 3 niveles)", () => {
    const projects: ProjectTreeInput[] = [
      { id: "root", name: "Reuniones", icon: "", parentProjectId: null, syncOrigin: "drive" },
      { id: "child", name: "Semana 1", icon: "", parentProjectId: "root", syncOrigin: "drive" },
      { id: "grandchild", name: "Lunes", icon: "", parentProjectId: "child", syncOrigin: "drive" },
      { id: "normal", name: "Personal", icon: "📁", parentProjectId: null, syncOrigin: "local" },
    ];
    const tree = buildProjectTree(projects);
    const totals = rollUpProjectCounts(tree, { root: 1, child: 2, grandchild: 3, normal: 5 });

    expect(totals.grandchild).toBe(3); // hoja: igual a su directo
    expect(totals.child).toBe(5); // 2 propio + 3 del nieto
    expect(totals.root).toBe(6); // 1 propio + 2 + 3 de sus descendientes
    expect(totals.normal).toBe(5); // sin hijos: igual a su directo
  });

  it("un proyecto sin conteo directo (no aparece en el map) cuenta como 0", () => {
    const projects: ProjectTreeInput[] = [
      { id: "root", name: "Reuniones", icon: "", parentProjectId: null, syncOrigin: "drive" },
      { id: "child", name: "Semana 1", icon: "", parentProjectId: "root", syncOrigin: "drive" },
    ];
    const tree = buildProjectTree(projects);
    const totals = rollUpProjectCounts(tree, { child: 4 });

    expect(totals.root).toBe(4);
    expect(totals.child).toBe(4);
  });
});

describe("collectProjectSubtreeIds", () => {
  it("borrar la raíz de un árbol de 3 niveles arrastra a hijo y nieto", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
      { id: "grandchild", parentProjectId: "child" },
      { id: "other", parentProjectId: null },
    ];
    const ids = collectProjectSubtreeIds("root", links);
    expect(Array.from(ids).sort()).toEqual(["child", "grandchild", "root"]);
  });

  it("borrar un nodo intermedio arrastra solo su propio subárbol, no a la raíz ni a hermanos", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
      { id: "grandchild", parentProjectId: "child" },
      { id: "sibling", parentProjectId: "root" },
    ];
    const ids = collectProjectSubtreeIds("child", links);
    expect(Array.from(ids).sort()).toEqual(["child", "grandchild"]);
  });

  it("borrar una hoja sin hijos devuelve solo su propio id", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "leaf", parentProjectId: "root" },
    ];
    expect(Array.from(collectProjectSubtreeIds("leaf", links))).toEqual(["leaf"]);
  });

  it("un id que no está en la lista (ej. ya no activo) devuelve solo ese id, sin explotar", () => {
    expect(Array.from(collectProjectSubtreeIds("no-existe", []))).toEqual(["no-existe"]);
  });

  it("no explota ante un ciclo corrupto (A→B→A)", () => {
    const links: ProjectParentLink[] = [
      { id: "a", parentProjectId: "b" },
      { id: "b", parentProjectId: "a" },
    ];
    expect(Array.from(collectProjectSubtreeIds("a", links)).sort()).toEqual(["a", "b"]);
  });
});

describe("planProjectDeletion", () => {
  it("proyecto hoja (sin hijos): hasChildren false, subtreeIds solo el propio id", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "leaf", parentProjectId: "root" },
    ];
    const plan = planProjectDeletion("leaf", links);
    expect(plan.hasChildren).toBe(false);
    expect(plan.childProjectCount).toBe(0);
    expect(plan.subtreeIds).toEqual(["leaf"]);
  });

  it("proyecto con hijos (árbol de 3 niveles): hasChildren true, cuenta agregada del subárbol completo", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
      { id: "grandchild", parentProjectId: "child" },
      { id: "other", parentProjectId: null },
    ];
    const plan = planProjectDeletion("root", links);
    expect(plan.hasChildren).toBe(true);
    expect(plan.childProjectCount).toBe(2); // child + grandchild, sin contar "other" ni el propio root
    expect(Array.from(plan.subtreeIds).sort()).toEqual(["child", "grandchild", "root"]);
  });

  it("proyecto sin subproyectos (aunque tenga transcripciones propias) se trata como hoja", () => {
    // La cantidad de transcripciones DIRECTAS del propio proyecto no afecta hasChildren: el
    // criterio es exclusivamente "tiene proyectos descendientes" (ver doc del guard en tree.ts).
    // Un proyecto sin hijos nunca puede tener transcripciones en DESCENDIENTES (no hay
    // descendientes), así que sigue siendo un borrado simple sin confirmación.
    const links: ProjectParentLink[] = [{ id: "solo", parentProjectId: null }];
    const plan = planProjectDeletion("solo", links);
    expect(plan.hasChildren).toBe(false);
    expect(plan.subtreeIds).toEqual(["solo"]);
  });

  it("id que no está en la lista (ej. ya no activo) devuelve plan de hoja con solo ese id", () => {
    const plan = planProjectDeletion("no-existe", []);
    expect(plan.hasChildren).toBe(false);
    expect(plan.subtreeIds).toEqual(["no-existe"]);
  });
});

describe("isProjectDeletionAuthorized", () => {
  it("un borrado sin descendientes siempre está autorizado, confirmado o no", () => {
    const links: ProjectParentLink[] = [{ id: "leaf", parentProjectId: null }];
    const plan = planProjectDeletion("leaf", links);
    expect(isProjectDeletionAuthorized(plan, false)).toBe(true);
    expect(isProjectDeletionAuthorized(plan, true)).toBe(true);
  });

  it("un borrado con descendientes SIN confirmar queda rechazado", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
    ];
    const plan = planProjectDeletion("root", links);
    expect(isProjectDeletionAuthorized(plan, false)).toBe(false);
  });

  it("un borrado con descendientes CONFIRMADO queda autorizado", () => {
    const links: ProjectParentLink[] = [
      { id: "root", parentProjectId: null },
      { id: "child", parentProjectId: "root" },
    ];
    const plan = planProjectDeletion("root", links);
    expect(isProjectDeletionAuthorized(plan, true)).toBe(true);
  });
});

describe("wouldCreateProjectCycle", () => {
  const links: ProjectParentLink[] = [
    { id: "root", parentProjectId: null },
    { id: "child", parentProjectId: "root" },
    { id: "grandchild", parentProjectId: "child" },
    { id: "other", parentProjectId: null },
  ];

  it("un proyecto no puede ser su propio padre", () => {
    expect(wouldCreateProjectCycle("root", "root", links)).toBe(true);
  });

  it("un proyecto no puede tener como padre a su propio descendiente (ciclo indirecto)", () => {
    expect(wouldCreateProjectCycle("root", "grandchild", links)).toBe(true);
    expect(wouldCreateProjectCycle("child", "grandchild", links)).toBe(true);
  });

  it("reasignar a un proyecto no emparentado no genera ciclo", () => {
    expect(wouldCreateProjectCycle("root", "other", links)).toBe(false);
    expect(wouldCreateProjectCycle("grandchild", "other", links)).toBe(false);
  });

  it("un nieto puede seguir teniendo como padre a su padre real (no-op válido)", () => {
    expect(wouldCreateProjectCycle("grandchild", "child", links)).toBe(false);
  });

  it("no explota ante un ciclo preexistente ajeno a la operación evaluada", () => {
    const corrupted: ProjectParentLink[] = [
      { id: "a", parentProjectId: "b" },
      { id: "b", parentProjectId: "a" },
    ];
    expect(wouldCreateProjectCycle("other", "a", corrupted)).toBe(false);
  });
});
