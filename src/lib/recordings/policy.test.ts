import { describe, it, expect } from "vitest";
import {
  LOCAL_LIBRARY_QUOTA_BYTES,
  classifyUploadFailure,
  canRetry,
  isIrreplaceable,
  selectPurgeCandidates,
  sortForDisplay,
  totalBytes,
  describeStatus,
} from "./policy";
import type { LocalRecordingMeta, LocalRecordingStatus } from "./types";

function meta(overrides: Partial<LocalRecordingMeta> = {}): LocalRecordingMeta {
  return {
    id: "r1",
    fileName: "Grabacion-1.webm",
    title: "Grabacion-1",
    mimeType: "audio/webm",
    sizeBytes: 1_000,
    durationSec: 30,
    createdAt: 1_000,
    source: "mic",
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

describe("classifyUploadFailure", () => {
  // The exact failure that lost a real user's recording: Vercel rejects the request at the edge,
  // BEFORE it reaches the route handler, and answers plain text — so `resp.json()` threw and the
  // UI showed `Unexpected token 'R', "Request En"...` plus a "Reintentar" that could never work.
  it("reconoce el 413 de plataforma (texto plano, no JSON) como too_large", () => {
    const result = classifyUploadFailure(413, "Request Entity Too Large");
    expect(result.status).toBe("too_large");
    expect(result.message).toContain("app de escritorio");
    expect(result.message).not.toContain("JSON");
  });

  it("reconoce el 413 aunque el cuerpo venga vacío o ilegible", () => {
    expect(classifyUploadFailure(413, "").status).toBe("too_large");
  });

  // Same platform limit, but some edges answer payload-too-large with a different status code.
  it("reconoce el texto de payload-too-large aunque el status no sea 413", () => {
    expect(classifyUploadFailure(500, "Request Entity Too Large").status).toBe("too_large");
    expect(classifyUploadFailure(null, "FUNCTION_PAYLOAD_TOO_LARGE").status).toBe("too_large");
  });

  it("usa el mensaje del server cuando la respuesta ES JSON nuestro", () => {
    const result = classifyUploadFailure(500, JSON.stringify({ error: "Groq no respondió." }));
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Groq no respondió.");
  });

  it("no confunde un JSON con campo `error` vacío con una respuesta sin mensaje", () => {
    const result = classifyUploadFailure(500, JSON.stringify({ error: "" }));
    expect(result.status).toBe("failed");
    expect(result.message.length).toBeGreaterThan(0);
  });

  // A network drop means the server never answered at all: no status, no body.
  it("clasifica una caída de red (sin status) como failed reintentable", () => {
    const result = classifyUploadFailure(null, "");
    expect(result.status).toBe("failed");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("nunca devuelve un mensaje con ruido de parseo de JSON", () => {
    const result = classifyUploadFailure(502, "<html>Bad Gateway</html>");
    expect(result.status).toBe("failed");
    expect(result.message).not.toContain("<html>");
    expect(result.message).not.toContain("Unexpected token");
  });
});

describe("canRetry", () => {
  it("permite reintentar lo que quedó pendiente o falló por una causa transitoria", () => {
    expect(canRetry(meta({ status: "pending" }))).toBe(true);
    expect(canRetry(meta({ status: "failed" }))).toBe(true);
  });

  // Retrying an oversized recording re-fails at the exact same check — offering the button is a lie.
  it("NO permite reintentar una grabación que no entra por la web", () => {
    expect(canRetry(meta({ status: "too_large" }))).toBe(false);
  });

  it("NO permite reintentar algo que el server ya aceptó (duplicaría la nota)", () => {
    expect(canRetry(meta({ status: "uploaded", transcriptionId: "t1" }))).toBe(false);
  });
});

describe("isIrreplaceable", () => {
  it("marca como irreemplazable todo lo que el server todavía no tiene", () => {
    const statuses: LocalRecordingStatus[] = ["pending", "too_large", "failed"];
    for (const status of statuses) expect(isIrreplaceable(meta({ status }))).toBe(true);
  });

  it("no marca como irreemplazable lo ya subido (vive en Storage)", () => {
    expect(isIrreplaceable(meta({ status: "uploaded" }))).toBe(false);
  });
});

describe("selectPurgeCandidates", () => {
  it("no purga nada mientras se entre en la cuota", () => {
    const recs = [meta({ id: "a", status: "uploaded", sizeBytes: 10 })];
    expect(selectPurgeCandidates(recs, { quotaBytes: 100 })).toEqual([]);
  });

  it("purga las subidas más viejas primero, hasta volver a entrar en la cuota", () => {
    const recs = [
      meta({ id: "old", status: "uploaded", sizeBytes: 40, createdAt: 1 }),
      meta({ id: "mid", status: "uploaded", sizeBytes: 40, createdAt: 2 }),
      meta({ id: "new", status: "uploaded", sizeBytes: 40, createdAt: 3 }),
    ];
    expect(selectPurgeCandidates(recs, { quotaBytes: 100 })).toEqual(["old"]);
  });

  // The whole point of the library: a recording the server does not have yet can never be
  // sacrificed to free space, no matter how old or how far over quota we are.
  it("NUNCA purga una grabación que el server todavía no tiene, aunque se pase de cuota", () => {
    const recs = [
      meta({ id: "pending-old", status: "pending", sizeBytes: 500, createdAt: 1 }),
      meta({ id: "oversize", status: "too_large", sizeBytes: 500, createdAt: 2 }),
      meta({ id: "failed", status: "failed", sizeBytes: 500, createdAt: 3 }),
    ];
    expect(selectPurgeCandidates(recs, { quotaBytes: 10 })).toEqual([]);
  });

  it("purga solo lo subido aunque haya pendientes ocupando la mayor parte de la cuota", () => {
    const recs = [
      meta({ id: "pending", status: "pending", sizeBytes: 90, createdAt: 1 }),
      meta({ id: "uploaded", status: "uploaded", sizeBytes: 90, createdAt: 2 }),
    ];
    expect(selectPurgeCandidates(recs, { quotaBytes: 100 })).toEqual(["uploaded"]);
  });

  it("frena cuando ya no queda nada purgable, sin entrar en bucle", () => {
    const recs = [
      meta({ id: "pending", status: "pending", sizeBytes: 900, createdAt: 1 }),
      meta({ id: "uploaded", status: "uploaded", sizeBytes: 50, createdAt: 2 }),
    ];
    expect(selectPurgeCandidates(recs, { quotaBytes: 100 })).toEqual(["uploaded"]);
  });

  it("usa la cuota por defecto si no se pasa una", () => {
    const recs = [meta({ id: "a", status: "uploaded", sizeBytes: LOCAL_LIBRARY_QUOTA_BYTES + 1, createdAt: 1 })];
    expect(selectPurgeCandidates(recs)).toEqual(["a"]);
  });
});

describe("sortForDisplay", () => {
  it("ordena de más nueva a más vieja", () => {
    const recs = [meta({ id: "a", createdAt: 1 }), meta({ id: "c", createdAt: 3 }), meta({ id: "b", createdAt: 2 })];
    expect(sortForDisplay(recs).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("no muta el array recibido", () => {
    const recs = [meta({ id: "a", createdAt: 1 }), meta({ id: "b", createdAt: 2 })];
    sortForDisplay(recs);
    expect(recs.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("totalBytes", () => {
  it("suma el tamaño de todas las grabaciones", () => {
    expect(totalBytes([meta({ sizeBytes: 10 }), meta({ sizeBytes: 32 })])).toBe(42);
  });

  it("devuelve 0 sin grabaciones", () => {
    expect(totalBytes([])).toBe(0);
  });
});

describe("describeStatus", () => {
  it("da un texto propio y sin jerga técnica para cada estado", () => {
    const statuses: LocalRecordingStatus[] = ["pending", "uploaded", "too_large", "failed"];
    const texts = statuses.map((status) => describeStatus(meta({ status })));
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/JSON|413|undefined|null/);
    }
    expect(new Set(texts).size).toBe(statuses.length); // cada estado dice algo distinto
  });

  it("prefiere el motivo real del último error cuando la subida falló", () => {
    expect(describeStatus(meta({ status: "failed", lastError: "No hay internet." }))).toContain("No hay internet.");
  });
});
