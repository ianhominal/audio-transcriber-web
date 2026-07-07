import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, signState, verifyState } from "./crypto";

// Clave de 32 bytes válida (openssl rand -base64 32), fija para que los tests sean reproducibles.
const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("hace round-trip del texto plano", () => {
    const plaintext = "1//0gLoremIpsumRefreshTokenDeGoogle";
    const encrypted = encryptSecret(plaintext, KEY);
    expect(decryptSecret(encrypted, KEY)).toBe(plaintext);
  });

  it("produce ciphertext distinto en cada llamada (IV aleatorio)", () => {
    const plaintext = "mismo-secreto";
    const a = encryptSecret(plaintext, KEY);
    const b = encryptSecret(plaintext, KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(plaintext);
    expect(decryptSecret(b, KEY)).toBe(plaintext);
  });

  it("falla al descifrar con la clave incorrecta", () => {
    const encrypted = encryptSecret("secreto", KEY);
    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow();
  });

  it("falla si el contenido fue alterado (authTag no matchea)", () => {
    const encrypted = encryptSecret("secreto", KEY);
    const [iv, authTag, data] = encrypted.split(".");
    const tampered = [iv, authTag, data.slice(0, -2) + (data.slice(-2) === "AA" ? "BB" : "AA")].join(".");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it("falla con formato inválido", () => {
    expect(() => decryptSecret("no-tiene-el-formato-correcto", KEY)).toThrow();
  });

  it("falla si la clave no decodifica a 32 bytes", () => {
    expect(() => encryptSecret("secreto", Buffer.from("corta").toString("base64"))).toThrow();
  });

  it("falla si falta la clave", () => {
    expect(() => encryptSecret("secreto", "")).toThrow();
  });
});

describe("signState / verifyState", () => {
  it("hace round-trip del payload", () => {
    const payload = { uid: "user-123", nonce: "abc" };
    const state = signState(payload, KEY);
    expect(verifyState(state, KEY)).toEqual(payload);
  });

  it("devuelve null si la firma no matchea (state alterado)", () => {
    const state = signState({ uid: "user-123" }, KEY);
    const [payloadB64] = state.split(".");
    const tampered = `${payloadB64}.firmaInventada`;
    expect(verifyState(tampered, KEY)).toBeNull();
  });

  it("devuelve null si se verifica con otra clave", () => {
    const state = signState({ uid: "user-123" }, KEY);
    expect(verifyState(state, OTHER_KEY)).toBeNull();
  });

  it("devuelve null con formato inválido", () => {
    expect(verifyState("sin-punto", KEY)).toBeNull();
  });
});
