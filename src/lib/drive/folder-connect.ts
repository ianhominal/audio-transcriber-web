/**
 * Lógica PURA del modal "Conectar carpeta de Drive" (Ajustes): decide si el nivel actual se puede
 * conectar sin riesgo y valida el nombre de una carpeta nueva antes de pedirle a Drive que la
 * cree. Sin I/O — la parte con red vive en `src/lib/drive/api.ts` (`createFolder`, `listFolderChildren`)
 * y en las rutas `src/app/api/drive/folders/*`.
 */
import { validateProjectName, type ProjectNameResult } from "@/lib/format";

/** Id que la Drive API entiende como alias de la raíz "Mi unidad" del usuario. */
export const DRIVE_ROOT_ID = "root";

/**
 * En la raíz ("Mi unidad", id `root`) conectar directo importaría TODO el Drive del usuario —
 * peligroso y poco obvio (el botón antes decía "Conectar 'Mi unidad'" sin dejar claro el alcance).
 * Fuera de la raíz, conectar es seguro: apunta a una carpeta puntual con su propia jerarquía.
 */
export function canConnectFolderLevel(folderId: string): boolean {
  return folderId !== DRIVE_ROOT_ID;
}

/** Valida el nombre de una carpeta nueva antes de crearla en Drive (mismas reglas que un nombre de proyecto). */
export function validateNewFolderName(name: string): ProjectNameResult {
  return validateProjectName(name);
}
