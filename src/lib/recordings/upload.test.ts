import { describe, it, expect } from "vitest";
import { interpretUploadResponse } from "./upload";

describe("interpretUploadResponse", () => {
  it("lee la transcripción creada en una respuesta OK", () => {
    const result = interpretUploadResponse(200, JSON.stringify({ id: "t1", audioStored: true }));
    expect(result).toMatchObject({ ok: true, transcriptionId: "t1", audioStored: true });
  });

  it("propaga el aviso de calidad cuando el server cambió de modelo por cuota", () => {
    const body = JSON.stringify({ id: "t1", qualityWarning: "Se usó otra calidad." });
    const result = interpretUploadResponse(200, body);
    expect(result).toMatchObject({ ok: true, qualityWarning: "Se usó otra calidad." });
  });

  // The bug that lost a recording: a 200 is not a promise that the body is JSON (a proxy or an
  // error page can answer 200 with HTML). Parsing must never throw out of this function.
  it("no explota si una respuesta OK trae un cuerpo que no es JSON", () => {
    const result = interpretUploadResponse(200, "<html>ok</html>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("Unexpected token");
  });

  it("clasifica el 413 de plataforma (texto plano) como too_large, sin ruido de parseo", () => {
    const result = interpretUploadResponse(413, "Request Entity Too Large");
    expect(result).toMatchObject({ ok: false, status: "too_large" });
    if (!result.ok) {
      expect(result.message).not.toContain("JSON");
      expect(result.rescuedId).toBeNull();
    }
  });

  // The server rescues the audio when transcription fails after the request landed. Retrying then
  // would create a SECOND note for the same audio, so the caller needs to know.
  it("expone el id que el server rescató cuando la transcripción falló pero la nota se creó", () => {
    const body = JSON.stringify({ error: "Groq no respondió.", id: "rescued-1" });
    const result = interpretUploadResponse(500, body);
    expect(result).toMatchObject({ ok: false, status: "failed", rescuedId: "rescued-1" });
    if (!result.ok) expect(result.message).toBe("Groq no respondió.");
  });

  it("trata una respuesta sin status (red caída) como fallo reintentable", () => {
    const result = interpretUploadResponse(null, "");
    expect(result).toMatchObject({ ok: false, status: "failed", rescuedId: null });
  });

  it("tolera un id ausente o de tipo inesperado en una respuesta OK", () => {
    expect(interpretUploadResponse(200, JSON.stringify({ id: 42 }))).toMatchObject({
      ok: true,
      transcriptionId: null,
    });
    expect(interpretUploadResponse(200, JSON.stringify({}))).toMatchObject({ ok: true, transcriptionId: null });
  });
});
