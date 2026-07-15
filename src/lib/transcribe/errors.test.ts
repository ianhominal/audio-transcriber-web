import { describe, expect, it } from "vitest";
import { friendlyTranscribeError } from "./errors";

/** The real message Groq returned when the account's daily audio quota ran out (413, not 429). */
const ASPD_MESSAGE =
  "Request too large for model `whisper-large-v3` in organization `org_01kb8514dje8zr2s8py1ywnh8s` " +
  "service tier `on_demand` on seconds of audio per day (ASPD): Limit 28800, Requested 42762, " +
  "please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at " +
  "https://console.groq.com/settings/billing";

describe("friendlyTranscribeError", () => {
  it("maps the daily audio quota error (arrives as 413) to a quota message, not a size message", () => {
    const result = friendlyTranscribeError(413, ASPD_MESSAGE);
    expect(result).toContain("límite de audio por hoy");
  });

  it("suggests the desktop app when the daily quota is exhausted (it transcribes locally, no cap)", () => {
    expect(friendlyTranscribeError(413, ASPD_MESSAGE)).toContain("app de escritorio");
  });

  it("treats a plain 413 without the quota marker as an oversized file", () => {
    expect(friendlyTranscribeError(413, "Request too large")).toContain("muy largo");
  });

  it("maps 429 to a saturation message", () => {
    expect(friendlyTranscribeError(429, "rate_limit_exceeded")).toContain("saturado");
  });

  it("maps 400 to a broken/unsupported audio message", () => {
    expect(friendlyTranscribeError(400, "could not decode audio")).toContain("dañado");
  });

  it("hides auth/config failures behind a generic unavailable message", () => {
    expect(friendlyTranscribeError(401, "Invalid API Key")).toContain("no está disponible");
    expect(friendlyTranscribeError(403, "forbidden")).toContain("no está disponible");
  });

  it("maps 5xx to a retry message", () => {
    expect(friendlyTranscribeError(503, "upstream error")).toContain("Probá de nuevo");
  });

  it("falls back to a generic message for unknown statuses", () => {
    expect(friendlyTranscribeError(418, undefined)).toBe("No se pudo completar la transcripción. Probá de nuevo.");
  });

  it("tolerates a missing/null provider message", () => {
    expect(() => friendlyTranscribeError(500, null)).not.toThrow();
    expect(friendlyTranscribeError(500)).toBeTruthy();
  });

  // The whole point of this module: the provider's text must never reach the UI.
  it("never leaks provider internals (org id, model, billing link) for any status", () => {
    for (const status of [400, 401, 403, 413, 429, 500, 503, 418]) {
      const result = friendlyTranscribeError(status, ASPD_MESSAGE);
      expect(result).not.toContain("org_01kb8514dje8zr2s8py1ywnh8s");
      expect(result).not.toContain("whisper-large-v3");
      expect(result).not.toContain("console.groq.com");
      expect(result).not.toContain("ASPD");
    }
  });
});
