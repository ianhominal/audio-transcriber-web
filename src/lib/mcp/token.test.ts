import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCP_TOKEN_PREFIX, generateMcpToken, hashMcpToken } from "./token";

const ORIGINAL_SECRET = process.env.MCP_TOKEN_HASH_SECRET;

function restoreSecret() {
  if (ORIGINAL_SECRET === undefined) delete process.env.MCP_TOKEN_HASH_SECRET;
  else process.env.MCP_TOKEN_HASH_SECRET = ORIGINAL_SECRET;
}

describe("hashMcpToken", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_HASH_SECRET = "unit-test-secret-do-not-use-in-prod";
  });

  afterEach(restoreSecret);

  it("is deterministic for the same token + secret", () => {
    const a = hashMcpToken("mcpt_sometoken");
    const b = hashMcpToken("mcpt_sometoken");
    expect(a).toBe(b);
  });

  it("produces different hashes for different tokens", () => {
    const a = hashMcpToken("mcpt_tokenA");
    const b = hashMcpToken("mcpt_tokenB");
    expect(a).not.toBe(b);
  });

  it("produces a different hash for the same token under a different secret", () => {
    const a = hashMcpToken("mcpt_sometoken");
    process.env.MCP_TOKEN_HASH_SECRET = "a-completely-different-secret";
    const b = hashMcpToken("mcpt_sometoken");
    expect(a).not.toBe(b);
  });

  it("returns a hex-encoded sha256 digest (64 lowercase hex chars)", () => {
    const hash = hashMcpToken("mcpt_sometoken");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed — throws — when MCP_TOKEN_HASH_SECRET is not set", () => {
    delete process.env.MCP_TOKEN_HASH_SECRET;
    expect(() => hashMcpToken("mcpt_sometoken")).toThrow();
  });

  it("fails closed — throws — when MCP_TOKEN_HASH_SECRET is an empty string", () => {
    process.env.MCP_TOKEN_HASH_SECRET = "";
    expect(() => hashMcpToken("mcpt_sometoken")).toThrow();
  });
});

describe("generateMcpToken", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_HASH_SECRET = "unit-test-secret-do-not-use-in-prod";
  });

  afterEach(restoreSecret);

  it("returns a token with the expected recognizable prefix", () => {
    const { token } = generateMcpToken();
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
  });

  it("returns a token with enough entropy (256 bits, base64url-encoded)", () => {
    const { token } = generateMcpToken();
    const secretPart = token.slice(MCP_TOKEN_PREFIX.length);
    // 32 raw bytes base64url-encoded (no padding) is 43 chars — allow a little slack.
    expect(secretPart.length).toBeGreaterThanOrEqual(40);
    expect(secretPart).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const a = generateMcpToken();
    const b = generateMcpToken();
    expect(a.token).not.toBe(b.token);
  });

  it("returns a hash that matches hashMcpToken(token) — callers only need to persist the hash", () => {
    const { token, hash } = generateMcpToken();
    expect(hash).toBe(hashMcpToken(token));
  });

  it("propagates the fail-closed error when MCP_TOKEN_HASH_SECRET is missing", () => {
    delete process.env.MCP_TOKEN_HASH_SECRET;
    expect(() => generateMcpToken()).toThrow();
  });
});
