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
  /** Color de acento del proyecto (Fase F2, id semántico de `src/lib/project-colors.ts`); `null`/
   * ausente = sin color/neutro. Opcional para no romper callers/tests que arman objetos sin
   * pensar en color (ej. los de `tree.test.ts` que solo ejercitan la jerarquía). */
  color?: string | null;
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
// A.1 Roll-up de conteos (sidebar): un padre muestra el total incluyendo descendientes
// ---------------------------------------------------------------------------

/**
 * Dado el árbol ya armado (`buildProjectTree`) y los conteos DIRECTOS por proyecto (ej.
 * transcripciones con `project_id = id`), devuelve un mapa id → total ACUMULADO (propio +
 * el de todos sus descendientes). Los proyectos sin hijos quedan igual que su conteo directo.
 * Puro y seguro ante ciclos: como `buildProjectTree` ya arma un árbol real (sin ciclos ni nodos
 * repetidos), la recursión siempre termina.
 */
export function rollUpProjectCounts(
  tree: ProjectTreeNode[],
  directCounts: Record<string, number>
): Record<string, number> {
  const totals: Record<string, number> = {};

  function visit(node: ProjectTreeNode): number {
    let total = directCounts[node.id] ?? 0;
    for (const child of node.children) {
      total += visit(child);
    }
    totals[node.id] = total;
    return total;
  }

  for (const root of tree) visit(root);
  return totals;
}

// ---------------------------------------------------------------------------
// A.2 Borrado en cascada: qué ids caen al soft-deletar un proyecto con hijos
// ---------------------------------------------------------------------------

export type ProjectParentLink = { id: string; parentProjectId: string | null };

/**
 * Dado el id de un proyecto a borrar y la lista PLANA de proyectos ACTIVOS del usuario
 * (`deleted_at is null`, mismo criterio que `buildProjectTree`), devuelve el set de ids que
 * caen en el borrado: el propio proyecto + TODO su subárbol (hijos, nietos, ...). Recorrido
 * BFS puro, sin I/O — el caller es quien aplica el `update({ deleted_at })` sobre estos ids
 * (proyectos y transcripciones).
 *
 * Defensivo: si `rootId` no está en `projects` (ej. ya no está activo), igual devuelve un set
 * con `rootId` solo — el caller decide qué hacer (la query de borrado simplemente no afecta
 * filas ya borradas). Anti-ciclo: un id nunca se agrega dos veces al set, así que un ciclo
 * corrupto en la FK no produce loop infinito.
 */
export function collectProjectSubtreeIds(rootId: string, projects: ProjectParentLink[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const p of projects) {
    if (!p.parentProjectId || p.parentProjectId === p.id) continue; // sin padre o auto-referencia corrupta
    const siblings = childrenByParent.get(p.parentProjectId);
    if (siblings) siblings.push(p.id);
    else childrenByParent.set(p.parentProjectId, [p.id]);
  }

  const ids = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (ids.has(childId)) continue; // anti-ciclo/duplicado
      ids.add(childId);
      queue.push(childId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// A.3 Guard de confirmación para borrado en cascada (usado por /api/sync/push)
// ---------------------------------------------------------------------------

export type ProjectDeletionPlan = {
  /** El propio proyecto + todo su subárbol (mismo resultado que `collectProjectSubtreeIds`). */
  subtreeIds: string[];
  /** true si tiene al menos un proyecto descendiente (hijo, nieto, ...). */
  hasChildren: boolean;
  /** Cantidad de proyectos descendientes (subtreeIds.length - 1, sin contar al propio proyecto). */
  childProjectCount: number;
};

/**
 * Bug crítico de pérdida silenciosa de datos (C1): el cliente desktop ve los proyectos como
 * lista PLANA (no conoce `parent_project_id`) y su freno anti-borrado-masivo solo cuenta
 * acciones de borrado LOCALES — no tiene forma de saber que borrar UN proyecto "vacío" en su
 * vista puede en realidad arrastrar (server-side, `/api/sync/push`) un subárbol entero con
 * transcripciones reales. Esta función es el cimiento PURO del guard: decide si un borrado es
 * "simple" (proyecto sin descendientes, comportamiento previo intacto, sin confirmación) o
 * "en cascada" (tiene descendientes, requiere confirmación explícita del caller).
 *
 * Nota clave: "sin hijos" implica "sin transcripciones en descendientes" (no puede haber
 * transcripciones en un descendiente que no existe) — por eso `hasChildren` alcanza para decidir
 * si hace falta confirmación; no hace falta mirar transcripciones acá (esas se cuentan aparte,
 * con I/O, en el caller — este módulo es puro).
 *
 * Reusa `collectProjectSubtreeIds` (única fuente de verdad del recorrido del árbol) en vez de
 * reimplementar el recorrido.
 */
export function planProjectDeletion(rootId: string, projects: ProjectParentLink[]): ProjectDeletionPlan {
  const subtreeIds = Array.from(collectProjectSubtreeIds(rootId, projects));
  const childProjectCount = subtreeIds.length - 1;
  return {
    subtreeIds,
    hasChildren: childProjectCount > 0,
    childProjectCount,
  };
}

/**
 * true si el borrado puede proceder: proyectos sin descendientes siempre están autorizados
 * (comportamiento previo, sin cambios); proyectos con descendientes solo si `confirmed` es true
 * (el caller mandó explícitamente el id en `projects.cascadeDeletes`, ver contrato en
 * `api/sync/push/route.ts`).
 */
export function isProjectDeletionAuthorized(plan: ProjectDeletionPlan, confirmed: boolean): boolean {
  return !plan.hasChildren || confirmed;
}

// ---------------------------------------------------------------------------
// A.4 Anti-ciclo al reasignar padre (usado por /api/sync/push)
// ---------------------------------------------------------------------------

/**
 * True si asignarle `newParentId` como padre a `projectId` crearía un ciclo (el proyecto
 * terminaría siendo su propio ancestro, directa o indirectamente). Cubre el caso trivial
 * (`newParentId === projectId`) y el indirecto (subir por la cadena de padres de `newParentId`
 * hasta encontrar `projectId`). Puro; no confía en que `projects` esté libre de ciclos previos
 * (si los hay, corta igual gracias al set de visitados, sin loop infinito).
 */
export function wouldCreateProjectCycle(
  projectId: string,
  newParentId: string,
  projects: ProjectParentLink[]
): boolean {
  if (projectId === newParentId) return true;

  const parentOf = new Map(projects.map((p) => [p.id, p.parentProjectId]));
  const visited = new Set<string>();
  let current: string | null = newParentId;
  while (current) {
    if (current === projectId) return true;
    if (visited.has(current)) return false; // ciclo preexistente ajeno a esta operación
    visited.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// A.5 Explorador jerárquico: contenido de una carpeta + breadcrumb
// ---------------------------------------------------------------------------

/**
 * Devuelve los subproyectos (subcarpetas) DIRECTOS de `folderId` a partir de la lista plana de
 * proyectos — mismo criterio de pertenencia que `buildProjectTree`, pero sin armar el árbol
 * completo (alcanza con un nivel para pintar el panel del explorador). Puro y genérico: sirve
 * tanto para la lista liviana del sidebar como para la lista completa (con `description`,
 * `createdAt`, etc.) que arma el panel principal.
 */
export function getSubfolders<T extends { parentProjectId: string | null }>(folderId: string, projects: T[]): T[] {
  return projects.filter((p) => p.parentProjectId === folderId);
}

/**
 * Arma el breadcrumb de un proyecto (raíz → ... → actual) siguiendo la cadena de
 * `parentProjectId` hacia arriba. Puro y genérico: devuelve los objetos originales, en orden,
 * así el caller decide qué campos renderizar (id/name/icon, etc.).
 *
 * Defensivo, mismo criterio que el resto del módulo: si `projectId` no está en `projects` (ej.
 * fue borrado o pertenece a otro usuario) devuelve `[]` en vez de lanzar; ante un ciclo corrupto
 * en la cadena de padres, corta al revisitar un id ya visto (no hay loop infinito).
 */
export function buildProjectBreadcrumb<T extends { id: string; parentProjectId: string | null }>(
  projectId: string,
  projects: T[]
): T[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const chain: T[] = [];
  const visited = new Set<string>();
  let current = byId.get(projectId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);
    current = current.parentProjectId ? byId.get(current.parentProjectId) : undefined;
  }
  return chain.reverse();
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
