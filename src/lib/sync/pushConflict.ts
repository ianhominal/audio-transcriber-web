/**
 * Team Sharing — Slice 1a (Identidad e integridad): resolución de conflicto de `/api/sync/push`
 * por `version`, no por reloj de cliente. Lógica PURA, sin Supabase — ver design.md ADR-07b/c/g.
 *
 * `version` decide si un write sigue siendo seguro (concurrencia optimista); el hash de contenido
 * (que vive del lado del desktop, `SyncBaseline.LastLocalHash`/`LastRemoteHash`) sigue decidiendo
 * si hay que actuar. No compiten: son ejes distintos (ADR-07).
 */

export type PushOutcome =
  | { status: "ok" }
  | { status: "conflict"; version: number }
  | { status: "error"; code: "client_too_old" };

/**
 * Decide el resultado de un upsert individual (proyecto o transcripción) contra la version actual
 * de la fila en el servidor.
 *
 * - `existingVersion`: `version` actual de la fila en la base, o `null` si la fila no existe todavía.
 * - `baseVersion`: `version` que el cliente dice haber leído la última vez (`base_version` del
 *   payload de push). `null`/`undefined` = el cliente no lo mandó.
 * - `isNewRow`: `true` cuando el upsert crea una fila que no existía — un ítem nuevo nunca puede
 *   estar en conflicto (no hay nada que pisar), así que ignora `baseVersion` por completo.
 *
 * Reglas (ADR-07b/c/g, en orden de evaluación):
 * 1. Fila nueva ⇒ siempre `ok`. No hay concurrencia que arbitrar.
 * 2. Fila existente sin `base_version` ⇒ `error: client_too_old` (backstop de contrato — un
 *    cliente que no manda `base_version` sobre una fila existente no puede distinguirse de uno
 *    viejo que ignora el protocolo; ver `isClientVersionAllowed` para la capa de header).
 * 3. Fila existente con `base_version` desactualizado (no matchea la version actual) ⇒ `conflict`,
 *    con la `version` del servidor — el servidor gana siempre, nunca el reloj del cliente (I-5).
 * 4. Fila existente con `base_version` al día ⇒ `ok`.
 */
export function resolvePushOutcome(
  existingVersion: number | null,
  baseVersion: number | null | undefined,
  isNewRow: boolean
): PushOutcome {
  if (isNewRow) return { status: "ok" };

  if (baseVersion === null || baseVersion === undefined) {
    return { status: "error", code: "client_too_old" };
  }

  if (existingVersion !== null && baseVersion !== existingVersion) {
    return { status: "conflict", version: existingVersion };
  }

  return { status: "ok" };
}

/** Versión mínima de cliente aceptada por `/api/sync/push` (ADR-07g). Debe coincidir con (o ser
 * menor o igual a) `SyncConfig.ClientVersion` del desktop una vez ese slice esté publicado — hasta
 * entonces, ningún desktop manda el header `x-client-version` y esta capa siempre rechaza; el
 * backstop de `resolvePushOutcome` (regla 2, sin `base_version`) es el que efectivamente protege
 * mientras tanto. */
export const MIN_SYNC_CLIENT_VERSION = "2.0.0";

function parseVersionParts(value: string): number[] | null {
  const parts = value.trim().split(".");
  if (parts.length === 0) return null;
  const numbers = parts.map((p) => Number(p));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return numbers;
}

/**
 * Compara un header `x-client-version` (formato `x.y.z`) contra la version mínima aceptada.
 * Header ausente o con formato inválido ⇒ `false` (deny-by-default, mismo criterio que I-3 del
 * kernel de permisos: un dato que no se puede interpretar no habilita nada).
 */
export function isClientVersionAllowed(header: string | null | undefined, min: string): boolean {
  if (!header) return false;

  const headerParts = parseVersionParts(header);
  const minParts = parseVersionParts(min);
  if (!headerParts || !minParts) return false;

  const length = Math.max(headerParts.length, minParts.length);
  for (let i = 0; i < length; i++) {
    const h = headerParts[i] ?? 0;
    const m = minParts[i] ?? 0;
    if (h > m) return true;
    if (h < m) return false;
  }
  return true; // igual al mínimo: permitido
}
