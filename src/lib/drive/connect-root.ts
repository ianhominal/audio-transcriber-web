/**
 * Qué hacer con el proyecto RAÍZ al conectar una carpeta de Drive.
 *
 * Existe por un reporte real: conectar una carpeta respondía 200 y no aparecía NADA en la lista de
 * proyectos, ni siquiera refrescando. La fila de `drive_folders` seguía apuntando a un proyecto que
 * el usuario había borrado en una prueba anterior, y la reconexión reusaba ese id muerto — así que la
 * importación entera caía dentro de un proyecto que estaba en la papelera. Todo "funcionaba" y nada
 * se veía.
 *
 * La reconexión sigue siendo idempotente mientras el proyecto mapeado esté VIVO; ese era el objetivo
 * original y no cambia. Lo que se agrega es la mitad que faltaba: un mapeo que apunta a la nada no es
 * una reconexión, es un mapeo roto, y hay que rehacerlo.
 */

export type RootProjectAction =
  /** No había mapeo: se crea el proyecto y se registra la carpeta. */
  | { action: "create" }
  /** Mapeo válido a un proyecto vivo: se reusa (reconexión idempotente). */
  | { action: "reuse"; projectId: string }
  /** Mapeo huérfano: se crea un proyecto nuevo y se repunta la fila de `drive_folders`. */
  | { action: "recreate"; staleProjectId: string };

export function resolveRootProjectAction({
  mappedProjectId,
  mappedProjectIsAlive,
}: {
  /** `local_project_id` de `drive_folders`, o `null` si la carpeta nunca se conectó. */
  mappedProjectId: string | null;
  /** `true` si ese proyecto existe y NO está borrado. */
  mappedProjectIsAlive: boolean;
}): RootProjectAction {
  if (!mappedProjectId) return { action: "create" };
  if (mappedProjectIsAlive) return { action: "reuse", projectId: mappedProjectId };
  return { action: "recreate", staleProjectId: mappedProjectId };
}
