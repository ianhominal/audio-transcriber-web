import { describe, it, expect, beforeEach, vi } from "vitest";

// Mismo patrón que `api/transcribe/route.test.ts`: mockear los límites de I/O real (sesión,
// settings del usuario) e inyectar valores fijos por test.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

vi.mock("@/lib/settings/user-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/user-settings")>();
  return { ...actual, getUserSettings: vi.fn() };
});

// El handler real llama DIRECTO al `POST` de `/api/transcribe` (sin red — ver comentario en
// route.ts) para no duplicar su lógica de auth/dedupe/rate-limit. Acá se mockea ESE límite: los
// tests de este archivo solo verifican el parseo del share_target (archivos, redirects), no el
// pipeline de transcripción en sí (ya cubierto por `api/transcribe/route.test.ts`).
vi.mock("@/app/api/transcribe/route", () => ({
  POST: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { getUserSettings } from "@/lib/settings/user-settings";
import { POST as transcribePost } from "@/app/api/transcribe/route";
import { SHARE_TARGET_FILE_FIELD, SHARE_TARGET_MAX_FILES } from "@/lib/share-target";
import { POST } from "./route";

function mockUser() {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: { id: "u1" } as never });
}

function mockDefaults() {
  vi.mocked(getUserSettings).mockResolvedValue({ engine: "groq", quality: "whisper-large-v3-turbo", language: "es" });
}

// Tipado como el retorno real de `transcribePost` (`NextResponse<...>`) para no repetir el cast en
// cada mock — a runtime es un `Response` común (`.json()`/`.ok`/`.status`), que es todo lo que
// `route.ts` lee de él.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }) as unknown as Awaited<ReturnType<typeof transcribePost>>;
}

function shareRequest(files: File[]) {
  const form = new FormData();
  // Usa el mismo campo que declara `manifest.ts` (`share_target.params.files[0].name`) — ver
  // `@/lib/share-target`, fuente única de verdad para ese nombre.
  for (const file of files) form.append(SHARE_TARGET_FILE_FIELD, file);
  const req = new Request("http://localhost/api/share-target", { method: "POST", body: form });
  return POST(req as never);
}

function audioFile(name = "voice-note.opus", bytes = "fake-audio-bytes") {
  return new File([bytes], name, { type: "audio/ogg" });
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(getUserSettings).mockReset();
  vi.mocked(transcribePost).mockReset();
});

describe("POST /api/share-target", () => {
  it("redirige a /login si no hay sesión", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const resp = await shareRequest([audioFile()]);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/login");
  });

  it("redirige a /app/capturar con shareError si no llegó ningún archivo", async () => {
    mockUser();
    mockDefaults();
    const resp = await shareRequest([]);
    expect(resp.status).toBe(303);
    const location = resp.headers.get("location") ?? "";
    expect(location).toContain("/app/capturar");
    expect(location).toContain("shareError=");
  });

  it("ignora entradas 'file' vacías (Chrome a veces manda un File de 0 bytes de placeholder)", async () => {
    mockUser();
    mockDefaults();
    const resp = await shareRequest([new File([], "empty.mp3", { type: "audio/mpeg" })]);
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/app/capturar");
  });

  it("con un solo archivo transcripto OK, redirige directo al detalle", async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost).mockResolvedValue(jsonResponse({ id: "t1", text: "hola" }, 200));

    const resp = await shareRequest([audioFile()]);

    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toContain("/app/t/t1");
    expect(transcribePost).toHaveBeenCalledTimes(1);
  });

  it("reenvía los defaults del usuario (idioma/calidad) y modo 'transcribe' en el forward", async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost).mockResolvedValue(jsonResponse({ id: "t1" }, 200));

    await shareRequest([audioFile()]);

    const forwardedReq = vi.mocked(transcribePost).mock.calls[0][0] as Request;
    const forwardedForm = await forwardedReq.formData();
    expect(forwardedForm.get("language")).toBe("es");
    expect(forwardedForm.get("model")).toBe("whisper-large-v3-turbo");
    expect(forwardedForm.get("mode")).toBe("transcribe");
    expect(forwardedForm.get("file")).toBeInstanceOf(File);
  });

  it("si /api/transcribe falla, redirige a /app/capturar con el mensaje de error", async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost).mockResolvedValue(jsonResponse({ error: "El audio supera los 25 MB." }, 413));

    const resp = await shareRequest([audioFile()]);

    expect(resp.status).toBe(303);
    const location = new URL(resp.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe("/app/capturar");
    expect(location.searchParams.get("shareError")).toBe("El audio supera los 25 MB.");
  });

  it("con varios archivos y al menos uno OK, redirige al dashboard (sin pantalla de resumen)", async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost)
      .mockResolvedValueOnce(jsonResponse({ id: "t1" }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: "t2" }, 200));

    const resp = await shareRequest([audioFile("a.mp3"), audioFile("b.mp3")]);

    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toMatch(/\/app\/?(\?.*)?$/);
    expect(transcribePost).toHaveBeenCalledTimes(2);
  });

  it("con varios archivos donde uno falla y otro ok, igual redirige al dashboard (no pierde el que sí anduvo)", async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost)
      .mockResolvedValueOnce(jsonResponse({ error: "falló" }, 500))
      .mockResolvedValueOnce(jsonResponse({ id: "t2" }, 200));

    const resp = await shareRequest([audioFile("a.mp3"), audioFile("b.mp3")]);

    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toMatch(/\/app\/?(\?.*)?$/);
    expect(resp.headers.get("location")).not.toContain("shareError");
  });

  it(`procesa como máximo SHARE_TARGET_MAX_FILES (${SHARE_TARGET_MAX_FILES}) archivos, ignora el resto en silencio (cota de maxDuration, review adversarial hallazgo MEDIUM)`, async () => {
    mockUser();
    mockDefaults();
    vi.mocked(transcribePost).mockResolvedValue(jsonResponse({ id: "tX" }, 200));

    const files = Array.from({ length: SHARE_TARGET_MAX_FILES + 5 }, (_, i) => audioFile(`f${i}.mp3`));
    const resp = await shareRequest(files);

    expect(resp.status).toBe(303);
    expect(transcribePost).toHaveBeenCalledTimes(SHARE_TARGET_MAX_FILES);
  });
});
