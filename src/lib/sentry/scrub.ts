import type { Breadcrumb, Event as SentryEvent } from "@sentry/nextjs";

/** `@sentry/nextjs` no exporta `QueryParams` públicamente; se deriva del propio `Event`. */
type QueryParams = NonNullable<SentryEvent["request"]>["query_string"];

/**
 * Scrubbing de PII/secretos antes de enviar un evento a Sentry.
 *
 * Esta app maneja datos privados (sesión de Supabase, tokens de Google Drive, audios y
 * transcripciones del usuario). Es lógica PURA (sin llamar a la red ni a Sentry) para poder
 * testearla con Vitest; se conecta como `beforeSend`/`beforeSendTransaction` en
 * `sentry.server.config.ts`, `sentry.edge.config.ts` e `instrumentation-client.ts`.
 *
 * Criterio: mejor pecar de conservador. Ante la duda, se redacta o se elimina el campo entero
 * en vez de intentar "limpiar" parcialmente un valor que podría contener un secreto.
 */

const REDACTED = "[redacted]";

/**
 * Nombres de key (headers, query params, extra/contexts) que se consideran sensibles.
 * Incluye `code`/`state` porque el callback OAuth de Google Drive (`/api/drive/callback`) recibe
 * el authorization code y el state en la query string — ambos son de un solo uso pero igual de
 * sensibles que un token mientras son válidos.
 */
const SENSITIVE_KEY_PATTERN =
  /token|secret|key|password|passwd|credential|cookie|authorization|refresh|code|state/i;

/** Headers que NUNCA se envían, más allá de si matchean el patrón anterior. */
const ALWAYS_STRIPPED_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);

/**
 * Patrones de secreto que pueden aparecer LIBRES dentro de `breadcrumb.message` — a diferencia de
 * `redactSensitiveKeys` (redacta por NOMBRE de key en objetos), acá no hay key: Sentry captura
 * breadcrumbs de `console.*` con texto libre en `.message` (ej. un `console.error` que loguea el
 * header completo o el token recibido), así que se redacta por CONTENIDO.
 *
 * Conservador a propósito (mismo criterio que el resto del archivo): el patrón de "string largo
 * sin espacios" puede redactar de más (ej. un UUID de proyecto/transcripción no es un secreto),
 * pero preferimos ese falso positivo antes que dejar pasar un token real.
 */
const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const LONG_TOKEN_LOOKALIKE_PATTERN = /\b[A-Za-z0-9_-]{24,}\b/g;

/** Redacta secretos por contenido (no por key) en un texto libre. Puro, sin mutar el input. */
function scrubMessageContent(message: string): string {
  return message
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(LONG_TOKEN_LOOKALIKE_PATTERN, REDACTED);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Redacta recursivamente cualquier valor cuya key matchee el patrón de datos sensibles. */
function redactSensitiveKeys<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveKeys(item)) as unknown as T;
  }
  if (!isPlainObject(input)) {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else if (isPlainObject(value) || Array.isArray(value)) {
      output[key] = redactSensitiveKeys(value);
    } else {
      output[key] = value;
    }
  }
  return output as T;
}

function scrubHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers;

  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    scrubbed[name] =
      ALWAYS_STRIPPED_HEADERS.has(lowerName) || SENSITIVE_KEY_PATTERN.test(lowerName)
        ? REDACTED
        : value;
  }
  return scrubbed;
}

function scrubQueryString(queryString: QueryParams | undefined): QueryParams | undefined {
  if (queryString === undefined) return queryString;

  if (typeof queryString === "string") {
    const params = new URLSearchParams(queryString);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        params.set(key, REDACTED);
      }
    }
    return params.toString();
  }

  if (Array.isArray(queryString)) {
    return queryString.map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value,
    ]) as Array<[string, string]>;
  }

  return redactSensitiveKeys(queryString);
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data && !breadcrumb.message) return breadcrumb;
  return {
    ...breadcrumb,
    data: breadcrumb.data ? redactSensitiveKeys(breadcrumb.data) : breadcrumb.data,
    message: breadcrumb.message ? scrubMessageContent(breadcrumb.message) : breadcrumb.message,
  };
}

/**
 * Limpia un evento de Sentry (error o transacción) antes de enviarlo.
 *
 * Reglas (todas conservadoras a propósito):
 * - `request.cookies`: se elimina siempre (contiene la cookie de sesión de Supabase,
 *   `sb-<ref>-auth-token`).
 * - `request.data` (body): se elimina siempre — puede traer audio en base64 o el texto de una
 *   transcripción, que es contenido privado del usuario, no un secreto de infraestructura pero
 *   igual de sensible.
 * - `request.env`: se elimina siempre (podría exponer variables de entorno del proceso).
 * - `request.headers` / `request.query_string`: se redactan por nombre (Authorization, Cookie,
 *   y cualquier header/param que matchee token|secret|key|password|credential|auth).
 * - `extra`, `contexts`, `breadcrumbs[].data`: redacción recursiva por nombre de key.
 * - `breadcrumbs[].message`: redacción por CONTENIDO (no hay key acá — es texto libre, típico de
 *   breadcrumbs de `console.*`) de patrones tipo `Bearer <token>`, JWT (`eyJ...`) y strings largos
 *   sin espacios que parezcan token.
 */
export function scrubSentryEvent<T extends SentryEvent>(event: T): T {
  const scrubbed: T = { ...event };

  if (scrubbed.request) {
    scrubbed.request = {
      ...scrubbed.request,
      headers: scrubHeaders(scrubbed.request.headers),
      query_string: scrubQueryString(scrubbed.request.query_string),
      cookies: undefined,
      data: undefined,
      env: undefined,
    };
  }

  if (scrubbed.extra) {
    scrubbed.extra = redactSensitiveKeys(scrubbed.extra) as SentryEvent["extra"];
  }

  if (scrubbed.contexts) {
    scrubbed.contexts = redactSensitiveKeys(scrubbed.contexts) as typeof scrubbed.contexts;
  }

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);
  }

  return scrubbed;
}
