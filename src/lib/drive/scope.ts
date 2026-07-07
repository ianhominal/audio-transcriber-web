/**
 * ACOTADO del motor de Drive-sync (doc 10, cimiento de jerarquía): PURO, sin I/O.
 *
 * El sync ya NO recorre todos los proyectos del usuario — solo los que cuelgan de una
 * `drive_folders` (proyecto raíz conectado a una carpeta de Drive) o de su subárbol vía
 * `parent_project_id`. Estas dos funciones calculan ese subárbol y, para cada proyecto en
 * alcance, a qué carpeta de Drive deben ir sus archivos.
 *
 * `buildProjectDriveFolderMap` resuelve, para cada proyecto, la carpeta de Drive de la carpeta/
 * subcarpeta que le corresponde: si el proyecto YA tiene su propia subcarpeta importada/creada
 * en Drive (mapeada en `drive_file_map` con `kind='project'`, ver la importación recursiva en
 * `/api/drive/folders/connect`), usa esa; si no, sube por la cadena de ancestros hasta encontrar
 * una carpeta conectada — hoy eso pasa con proyectos creados a mano DENTRO del árbol de Drive que
 * todavía no tienen contraparte en Drive (crearla ahí es trabajo futuro: "nube → Drive" en el
 * doc 10).
 */

export type ProjectLite = { id: string; parentProjectId: string | null };

export type DriveFolderLite = { driveFolderId: string; localProjectId: string };

/**
 * Calcula el conjunto de `project.id` que están "bajo Drive": las raíces conectadas
 * (`rootProjectIds`, típicamente `drive_folders.local_project_id`) más todos sus
 * descendientes recorriendo `parent_project_id` (BFS). Si un proyecto no aparece acá, el
 * motor de sync no debe tocarlo — es el corazón del ACOTADO.
 *
 * Defensivo contra ciclos corruptos (no deberían existir por la FK + validación server-side,
 * pero esta función no confía en eso): un proyecto ya visitado no se vuelve a encolar.
 */
export function computeDriveScopeProjectIds(allProjects: ProjectLite[], rootProjectIds: string[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const p of allProjects) {
    if (!p.parentProjectId) continue;
    const siblings = childrenByParent.get(p.parentProjectId) ?? [];
    siblings.push(p.id);
    childrenByParent.set(p.parentProjectId, siblings);
  }

  const scope = new Set<string>();
  const queue = [...rootProjectIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (scope.has(id)) continue;
    scope.add(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!scope.has(childId)) queue.push(childId);
    }
  }
  return scope;
}

/**
 * Para cada proyecto de `allProjects`, resuelve el `drive_folder_id` de Drive donde deben
 * vivir sus archivos: sube por la cadena de `parent_project_id` hasta encontrar un ancestro
 * (o el propio proyecto) que sea raíz de una `drive_folders`. Un proyecto fuera del árbol de
 * Drive no aparece en el mapa devuelto (consistente con `computeDriveScopeProjectIds`).
 */
export function buildProjectDriveFolderMap(
  allProjects: ProjectLite[],
  driveFolders: DriveFolderLite[]
): Map<string, string> {
  const parentById = new Map(allProjects.map((p) => [p.id, p.parentProjectId]));
  const rootDriveFolderByProjectId = new Map(driveFolders.map((f) => [f.localProjectId, f.driveFolderId]));

  const result = new Map<string, string>();
  for (const project of allProjects) {
    let current: string | null = project.id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const driveFolderId = rootDriveFolderByProjectId.get(current);
      if (driveFolderId) {
        result.set(project.id, driveFolderId);
        break;
      }
      current = parentById.get(current) ?? null;
    }
  }
  return result;
}
