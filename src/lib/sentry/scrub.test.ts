import { describe, it, expect } from "vitest";
import { scrubSentryEvent } from "./scrub";
import type { ErrorEvent } from "@sentry/nextjs";

function baseEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    message: "algo explotó",
    ...overrides,
  };
}

describe("scrubSentryEvent", () => {
  it("elimina el header Authorization", () => {
    const event = baseEvent({
      request: { headers: { Authorization: "Bearer sk-supersecreto", "content-type": "application/json" } },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.headers?.Authorization).toBe("[redacted]");
    expect(result.request?.headers?.["content-type"]).toBe("application/json");
  });

  it("elimina el header Cookie sin importar el nombre exacto", () => {
    const event = baseEvent({
      request: { headers: { Cookie: "sb-abc-auth-token=eyJ...; other=1" } },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.headers?.Cookie).toBe("[redacted]");
  });

  it("elimina request.cookies por completo (sesión de Supabase)", () => {
    const event = baseEvent({
      request: { cookies: { "sb-abc-auth-token": "eyJ...", theme: "dark" } },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.cookies).toBeUndefined();
  });

  it("elimina request.data por completo (puede traer audio o texto transcripto)", () => {
    const event = baseEvent({
      request: { data: { audioBase64: "AAAA", text: "transcripción privada" } },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.data).toBeUndefined();
  });

  it("elimina request.env por completo", () => {
    const event = baseEvent({
      request: { env: { SUPABASE_SERVICE_ROLE_KEY: "xyz" } },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.env).toBeUndefined();
  });

  it("redacta query params sensibles y deja pasar los inofensivos", () => {
    const event = baseEvent({
      request: { query_string: "code=abc123&page=2&access_token=shh" },
    });

    const result = scrubSentryEvent(event);
    const params = new URLSearchParams(result.request?.query_string as string);

    expect(params.get("page")).toBe("2");
    expect(params.get("code")).toBe("[redacted]");
    expect(params.get("access_token")).toBe("[redacted]");
  });

  it("redacta query params sensibles cuando vienen como array de tuplas", () => {
    const event = baseEvent({
      request: { query_string: [["secret", "shh"], ["page", "2"]] },
    });

    const result = scrubSentryEvent(event);

    expect(result.request?.query_string).toEqual([
      ["secret", "[redacted]"],
      ["page", "2"],
    ]);
  });

  it("redacta recursivamente extra y contexts por nombre de key", () => {
    const event = baseEvent({
      extra: { driveRefreshToken: "abc", projectId: "42" },
      contexts: { nested: { apiKey: "abc", nested2: { userAgent: "vitest" } } },
    });

    const result = scrubSentryEvent(event);

    expect(result.extra).toEqual({ driveRefreshToken: "[redacted]", projectId: "42" });
    expect(result.contexts?.nested).toEqual({
      apiKey: "[redacted]",
      nested2: { userAgent: "vitest" },
    });
  });

  it("redacta breadcrumbs.data por nombre de key sin tocar breadcrumbs sin data", () => {
    const event = baseEvent({
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/x", token: "shh" } },
        { category: "ui.click" },
      ],
    });

    const result = scrubSentryEvent(event);

    expect(result.breadcrumbs?.[0].data).toEqual({ url: "/api/x", token: "[redacted]" });
    expect(result.breadcrumbs?.[1]).toEqual({ category: "ui.click" });
  });

  it("no toca eventos sin request/extra/contexts/breadcrumbs", () => {
    const event = baseEvent();

    const result = scrubSentryEvent(event);

    expect(result.message).toBe("algo explotó");
    expect(result.request).toBeUndefined();
  });

  it("no muta el objeto original", () => {
    const original = baseEvent({
      request: { headers: { Authorization: "Bearer shh" } },
    });

    scrubSentryEvent(original);

    expect(original.request?.headers?.Authorization).toBe("Bearer shh");
  });
});
