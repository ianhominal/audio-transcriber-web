/**
 * Cifrado simétrico (AES-256-GCM) para secretos de larga vida guardados en la base de datos
 * (hoy: el refresh token de Drive en `drive_connections.refresh_token_encrypted`).
 *
 * También incluye `signState`/`verifyState`: un JWT casero (HMAC-SHA256) para el `state` del
 * flujo OAuth de Drive (anti-CSRF, atado al usuario logueado). No hace falta una librería de JWT
 * para un payload tan chico; `node:crypto` alcanza y no agrega dependencias.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado por Node para GCM (96 bits)

/** Decodifica la clave desde base64 y valida que tenga 32 bytes (AES-256). Falla rápido si no. */
function decodeKey(base64Key: string): Buffer {
  if (!base64Key) {
    throw new Error("Falta la clave de cifrado (DRIVE_TOKEN_KEY).");
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error(
      "DRIVE_TOKEN_KEY debe decodificar a 32 bytes (AES-256). Generala con: openssl rand -base64 32"
    );
  }
  return key;
}

/**
 * Cifra un texto plano con AES-256-GCM. Devuelve `iv.authTag.ciphertext` (cada parte en
 * base64), autocontenido para poder descifrarlo después sin guardar nada más aparte.
 */
export function encryptSecret(plaintext: string, base64Key: string): string {
  const key = decodeKey(base64Key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/**
 * Descifra un string producido por `encryptSecret`. Lanza si el formato es inválido, la clave
 * es incorrecta, o el contenido fue alterado (el authTag de GCM no matchea).
 */
export function decryptSecret(packed: string, base64Key: string): string {
  const key = decodeKey(base64Key);
  const parts = packed.split(".");
  if (parts.length !== 3) {
    throw new Error("Formato de secreto cifrado inválido.");
  }
  const [ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Firma un payload con HMAC-SHA256 usando la misma clave que el cifrado. Formato: `payload.firma` (base64url). */
export function signState(payload: Record<string, unknown>, base64Key: string): string {
  const key = decodeKey(base64Key);
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verifica un `state` firmado con `signState`. Devuelve el payload si la firma es válida
 * (comparación en tiempo constante), o `null` si está corrupto, alterado o mal formado.
 */
export function verifyState<T = Record<string, unknown>>(state: string, base64Key: string): T | null {
  const key = decodeKey(base64Key);
  const [payloadB64, signature] = state.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = createHmac("sha256", key).update(payloadB64).digest("base64url");
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
