import { timingSafeEqual } from "node:crypto";

/**
 * Compara dos strings en tiempo constante (evita timing attacks sobre CRON_SECRET).
 * Si las longitudes difieren, igual corre una comparación (contra sí mismo) para no
 * filtrar esa diferencia por el tiempo de respuesta, y devuelve `false` sin lanzar excepción.
 *
 * Mismo helper que ya usaba `api/cron/purge/route.ts` (antes definido ahí en privado); se movió
 * acá para reusarlo también en `api/cron/drive-sync/route.ts` sin duplicar la lógica ni tocar el
 * cron de purga existente.
 */
function safeCompare(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);

  if (candidateBuf.length !== expectedBuf.length) {
    timingSafeEqual(candidateBuf, candidateBuf);
    return false;
  }

  return timingSafeEqual(candidateBuf, expectedBuf);
}

/**
 * True si el secreto recibido (header `Authorization: Bearer <secret>` o query `?secret=`)
 * matchea `expected` (normalmente `process.env.CRON_SECRET`). `expected` faltante siempre
 * devuelve `false` (fail-closed: sin secreto configurado, no se autoriza nada).
 */
export function isAuthorizedCronSecret(
  headerSecret: string | null,
  querySecret: string | null,
  expected: string | undefined
): boolean {
  if (!expected) return false;
  if (headerSecret && safeCompare(headerSecret, expected)) return true;
  if (querySecret && safeCompare(querySecret, expected)) return true;
  return false;
}

/** Extrae el secreto del header `Authorization: Bearer <secret>` de un `Request`/`NextRequest`. */
export function bearerSecretFromHeader(authorizationHeader: string | null): string | null {
  return authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : null;
}
