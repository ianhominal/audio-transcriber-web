import { describe, it, expect } from "vitest";
import { buildTranscribeForm, nextMetaAfterUpload } from "./flow";
import type { UploadSuccess } from "./upload";

function success(overrides: Partial<UploadSuccess> = {}): UploadSuccess {
  return {
    ok: true,
    transcriptionId: "t1",
    qualityWarning: null,
    audioStored: true,
    duplicate: false,
    title: null,
    tags: [],
    translationWarning: false,
    ...overrides,
  };
}

describe("buildTranscribeForm", () => {
  const file = new File(["audio"], "Grabacion-1.webm", { type: "audio/webm" });

  it("manda el archivo con su nombre y los campos base de transcripción", () => {
    const form = buildTranscribeForm(file, {
      language: "es",
      model: "whisper-large-v3-turbo",
      mode: "transcribe",
      title: "Grabacion-1",
    });
    expect((form.get("file") as File).name).toBe("Grabacion-1.webm");
    expect(form.get("language")).toBe("es");
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("mode")).toBe("transcribe");
    expect(form.get("title")).toBe("Grabacion-1");
  });

  it("omite los campos opcionales que no se pasaron", () => {
    const form = buildTranscribeForm(file, { language: "es", model: "m", mode: "transcribe", title: "t" });
    expect(form.get("projectId")).toBeNull();
    expect(form.get("targetLanguage")).toBeNull();
  });

  it("incluye proyecto, idioma destino y vocabulario cuando se piden", () => {
    const form = buildTranscribeForm(file, {
      language: "es",
      model: "m",
      mode: "translate",
      title: "t",
      projectId: "p1",
      targetLanguage: "en",
      useVocabulary: true,
    });
    expect(form.get("projectId")).toBe("p1");
    expect(form.get("targetLanguage")).toBe("en");
    expect(form.get("useVocabulary")).toBe("true");
  });
});

describe("nextMetaAfterUpload", () => {
  it("marca como subida y guarda el id de la transcripción", () => {
    const patch = nextMetaAfterUpload(success(), 0);
    expect(patch).toMatchObject({ status: "uploaded", transcriptionId: "t1", attempts: 1 });
  });

  // Otherwise a recording that failed once and then succeeded keeps showing the stale error.
  it("limpia el error anterior al subir bien", () => {
    const patch = nextMetaAfterUpload(success(), 3);
    expect(patch.lastError).toBeUndefined();
    expect(patch.attempts).toBe(4);
  });

  it("marca como too_large sin ofrecer más reintentos", () => {
    const patch = nextMetaAfterUpload({ ok: false, status: "too_large", message: "No entra.", rescuedId: null }, 0);
    expect(patch).toMatchObject({ status: "too_large", lastError: "No entra." });
  });

  it("guarda el motivo del fallo para mostrarlo en la lista", () => {
    const patch = nextMetaAfterUpload({ ok: false, status: "failed", message: "Sin señal.", rescuedId: null }, 1);
    expect(patch).toMatchObject({ status: "failed", lastError: "Sin señal.", attempts: 2 });
  });

  // The server saved the audio and created a note; retrying would create a second one.
  it("da por subida la grabación que el server rescató, para no duplicar la nota", () => {
    const patch = nextMetaAfterUpload({ ok: false, status: "failed", message: "Falló.", rescuedId: "r1" }, 0);
    expect(patch).toMatchObject({ status: "uploaded", transcriptionId: "r1" });
  });
});
