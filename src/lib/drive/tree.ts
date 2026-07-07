/**
 * Lógica PURA de jerarquía para Drive-sync v2 (doc 10, importación recursiva + sidebar en árbol).
 * Sin I/O: recibe estructuras ya resueltas y devuelve estructuras/planes. Toda la parte con
 * llamadas reales a Drive/Supabase vive en `src/lib/drive/api.ts` (fetch del árbol) y en las
 * rutas de `src/app/api/drive/folders/*` (ejecución del plan).
 */

// ---------------------------------------------------------------------------
// A. Árbol de proyectos para el sidebar (a partir de la lista plana con parent_project_id)
// ---------------------------------------------------------------------------

export type ProjectTreeInput = {
  id: string;
  name: string;
  icon: string;
  parentProjectId: string | null;
  syncOrigin: string;
};

export type ProjectTreeNode = ProjectTreeInput & { children: ProjectTreeNode[] };

/**
 * Arma el árbol de proyectos a partir de la lista plana (`parent_project_id`). Los proyectos
 * "normales" (sin padre) quedan como raíces, igual que hoy; los de Drive con jerarquía cuelgan
 * de su padre. Preserva el orden relativo de `projects` dentro de cada nivel.
 *
 * Defensivo (mismo criterio que `computeDriveScopeProjectIds` en scope.ts): un `parentProjectId`
 * que apunta a un id inexistente hace que el proyecto caiga como raíz (huérfano visible, no se
 * pierde). Un ciclo corrupto (A padre de B, B padre de A) hace que ambos queden anidados entre sí
 * pero NINGUNO cuelga de una raíz real — no se renderizan (no hay corrupción posible en la FK real,
 * pero esta función no confía en eso, y así tampoco entra en loop infinito al recorrer children).
 */
export function buildProjectTree(projects: ProjectTreeInput[]): ProjectTreeNode[] {
  const nodeById = new Map<string, ProjectTreeNode>();
  for (const p of projects) {
    nodeById.set(p.id, { ...p, children: [] });
  }

  const roots: ProjectTreeNode[] = [];
  for (const p of projects) {
    const node = nodeById.get(p.id) as ProjectTreeNode;
    const parent = p.parentProjectId && p.parentProjectId !== p.id ? nodeById.get(p.parentProjectId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// B. Planificador de importación recursiva (Drive → app)
// ---------------------------------------------------------------------------

/** Nodo de un árbol de Drive YA TRAÍDO (fetch recursivo hecho aparte, en `api.ts`). Sin I/O acá. */
export type DriveTreeNode = {
  driveId: string;
  name: string;
  isFolder: boolean;
  /** Solo tiene sentido cuando `isFolder`. Puede faltar si no se pudo listar (defensivo). */
  children?: DriveTreeNode[];
};

export type PlannedProjectStep = {
  driveFolderId: string;
  name: string;
  /** Drive folder id del padre inmediato — puede ser la raíz conectada u otra carpeta a crear en este mismo plan. */
  parentDriveFolderId: string;
};

export type PlannedTranscriptionStep = {
  driveFileId: string;
  name: string;
  parentDriveFolderId: string;
};

export type DriveImportPlan = {
  /** En orden padre-primero (pre-order): siempre se puede resolver el `local id` del padre antes de crear el hijo. */
  projectsToCreate: PlannedProjectStep[];
  transcriptionsToCreate: PlannedTranscriptionStep[];
  /** Carpetas que ya estaban mapeadas (reconexión idempotente): no se crean de nuevo, pero SÍ se desciende dentro. */
  skippedExistingFolders: number;
  /** Archivos `.md` que ya estaban mapeados: no se duplican. */
  skippedExistingFiles: number;
  /** Archivos que no son carpeta ni `.md` (audio, PDF, etc.): fuera de alcance de esta fase, se ignoran. */
  skippedOtherFiles: number;
  /** `true` si algún subárbol se cortó por superar `maxDepth` (protección anti-recursión-infinita). */
  depthTruncated: boolean;
};

const DEFAULT_MAX_DEPTH = 20;

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/**
 * Dado el árbol de Drive de la carpeta RAÍZ ya conectada (`root`, con `root.driveId` = la carpeta
 * que el usuario eligió, cuyo proyecto local ya existe de antes), decide qué subproyectos y qué
 * transcripciones crear, y con qué padre (`parentDriveFolderId`).
 *
 * Idempotente: `existingFolderIds`/`existingFileIds` son los `drive_file_id` ya mapeados
 * (`drive_file_map`, sin `deleted_at`) — lo que ya está mapeado NO se vuelve a planear, pero una
 * carpeta ya existente igual se recorre (para descubrir hijos nuevos de una importación parcial
 * anterior). El propio `root` nunca se emite como paso (ya existe por construcción del caller).
 *
 * Anti-recursión-infinita: set de visitados (un `driveId` no se procesa dos veces, ni siquiera si
 * aparece en más de una rama) + `maxDepth` (por defecto 20 niveles).
 */
export function planDriveImport(
  root: DriveTreeNode,
  opts: { existingFolderIds?: Set<string>; existingFileIds?: Set<string>; maxDepth?: number } = {}
): DriveImportPlan {
  const existingFolderIds = opts.existingFolderIds ?? new Set<string>();
  const existingFileIds = opts.existingFileIds ?? new Set<string>();
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  const projectsToCreate: PlannedProjectStep[] = [];
  const transcriptionsToCreate: PlannedTranscriptionStep[] = [];
  let skippedExistingFolders = 0;
  let skippedExistingFiles = 0;
  let skippedOtherFiles = 0;
  let depthTruncated = false;

  const visited = new Set<string>([root.driveId]);

  function walk(node: DriveTreeNode, parentDriveFolderId: string, depth: number): void {
    if (depth > maxDepth) {
      if ((node.children?.length ?? 0) > 0) depthTruncated = true;
      return;
    }
    for (const child of node.children ?? []) {
      if (visited.has(child.driveId)) continue; // anti-ciclo/duplicado
      visited.add(child.driveId);

      if (child.isFolder) {
        if (existingFolderIds.has(child.driveId)) {
          skippedExistingFolders++;
        } else {
          projectsToCreate.push({ driveFolderId: child.driveId, name: child.name, parentDriveFolderId });
        }
        walk(child, child.driveId, depth + 1);
      } else if (isMarkdownFile(child.name)) {
        if (existingFileIds.has(child.driveId)) {
          skippedExistingFiles++;
        } else {
          transcriptionsToCreate.push({ driveFileId: child.driveId, name: child.name, parentDriveFolderId });
        }
      } else {
        skippedOtherFiles++;
      }
    }
  }

  walk(root, root.driveId, 1);

  return {
    projectsToCreate,
    transcriptionsToCreate,
    skippedExistingFolders,
    skippedExistingFiles,
    skippedOtherFiles,
    depthTruncated,
  };
}
