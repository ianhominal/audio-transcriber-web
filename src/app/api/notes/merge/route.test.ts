import { describe, it, expect, beforeEach, vi } from "vitest";

// `getApiUser` does real I/O (cookies/JWT) — mocked to inject a fixed user and a fake Supabase
// client controlled by each test, same pattern as `api/chat/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

// `streamText` does real network calls to Groq — mocked so auth/ownership/cap can be tested WITHOUT
// calling a real LLM, same pattern as `api/recipes/apply` (implicit) and `api/chat`.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock("@ai-sdk/groq", () => ({
  groq: vi.fn(() => ({ __fakeGroqModel: true })),
}));

import { getApiUser } from "@/lib/supabase/api";
import { streamText } from "ai";
import { POST } from "./route";
import { MAX_MERGE_NOTES } from "@/lib/merge/validate";

type NotesResult = {
  data: { id: string; title: string | null; text: string | null; created_at: string }[] | null;
  error: { message: string; code?: string } | null;
};
type InsertResult = { error: { message: string; code?: string } | null };

function createTranscriptionsQuery(result: NotesResult) {
  const q = {
    select() {
      return q;
    },
    in() {
      return q;
    },
    eq() {
      return q;
    },
    is() {
      return Promise.resolve(result);
    },
  };
  return q;
}

function createFakeSupabase(options: { notes?: NotesResult; usageLogInsert?: InsertResult }) {
  const usageLogInsertCalls: unknown[] = [];

  const notesResult: NotesResult = options.notes ?? {
    data: [
      { id: "n1", title: "Nota 1", text: "Texto de la nota 1.", created_at: "2026-07-01T00:00:00.000Z" },
      { id: "n2", title: "Nota 2", text: "Texto de la nota 2.", created_at: "2026-07-02T00:00:00.000Z" },
    ],
    error: null,
  };
  const usageLogResult = options.usageLogInsert ?? { error: null };

  return {
    from(table: string) {
      if (table === "transcriptions") return createTranscriptionsQuery(notesResult);
      if (table === "ai_usage_log") {
        return {
          insert(payload: unknown) {
            usageLogInsertCalls.push(payload);
            return Promise.resolve(usageLogResult);
          },
        };
      }
      throw new Error(`Tabla inesperada en el test: ${table}`);
    },
    usageLogInsertCalls,
  };
}

function mockUser(supabase: ReturnType<typeof createFakeSupabase>, userId = "u1") {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: userId } as never });
}

function postMerge(body: unknown) {
  const req =
    typeof body === "string"
      ? new Request("http://localhost/api/notes/merge", { method: "POST", body })
      : new Request("http://localhost/api/notes/merge", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

function mockStreamTextResult() {
  const toTextStreamResponse = vi.fn(() => new Response(null, { status: 200, headers: {} }));
  const consumeStream = vi.fn();
  vi.mocked(streamText).mockReturnValue({ toTextStreamResponse, consumeStream } as never);
  return { toTextStreamResponse, consumeStream };
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(streamText).mockReset();
  process.env.GROQ_API_KEY = "test-key";
});

describe("POST /api/notes/merge — auth y validación", () => {
  it("401 sin sesión", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(401);
  });

  it("500 sin GROQ_API_KEY configurada", async () => {
    delete process.env.GROQ_API_KEY;
    mockUser(createFakeSupabase({}));
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(500);
  });

  it("400 con body no-JSON", async () => {
    mockUser(createFakeSupabase({}));
    const res = await postMerge("no-es-json");
    expect(res.status).toBe(400);
  });

  it("400 con transcriptionIds ausente o vacío", async () => {
    mockUser(createFakeSupabase({}));
    expect((await postMerge({})).status).toBe(400);
    expect((await postMerge({ transcriptionIds: [] })).status).toBe(400);
  });

  it("400 con un solo id (por debajo del mínimo)", async () => {
    mockUser(createFakeSupabase({}));
    const res = await postMerge({ transcriptionIds: ["n1"] });
    expect(res.status).toBe(400);
  });

  it(`400 con más de ${MAX_MERGE_NOTES} ids`, async () => {
    mockUser(createFakeSupabase({}));
    const ids = Array.from({ length: MAX_MERGE_NOTES + 1 }, (_, i) => `n${i}`);
    const res = await postMerge({ transcriptionIds: ids });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/notes/merge — ownership (anti-IDOR)", () => {
  it("404 genérico cuando uno de los ids es de OTRO usuario o no existe (RLS/filtro no lo devuelve)", async () => {
    // 2 ids are requested but the Supabase mock (scoped to `user_id` + RLS) only returns 1 row —
    // simulates "n2" belonging to another user or not existing. The endpoint must reject the WHOLE
    // request with 404, never processing just "n1".
    const supabase = createFakeSupabase({
      notes: {
        data: [{ id: "n1", title: "Nota propia", text: "texto", created_at: "2026-07-01T00:00:00.000Z" }],
        error: null,
      },
    });
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postMerge({ transcriptionIds: ["n1", "n2-ajena"] });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("No pudimos encontrar alguna de las notas elegidas.");
    // Must never reveal WHICH id failed, nor proceed generating with the subset.
    expect(JSON.stringify(json)).not.toContain("n2-ajena");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("500 ante un error real de la query de notas (no lo disfraza de 404)", async () => {
    const supabase = createFakeSupabase({ notes: { data: null, error: { message: "connection reset" } } });
    mockUser(supabase);
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(500);
  });

  it("dedupe: ids repetidos cuentan una sola vez para el chequeo de ownership", async () => {
    const supabase = createFakeSupabase({
      notes: {
        data: [{ id: "n1", title: "Nota", text: "texto", created_at: "2026-07-01T00:00:00.000Z" }],
        error: null,
      },
    });
    mockUser(supabase);
    mockStreamTextResult();

    // "n1" repeated three times dedupes to 1 id — below the minimum of 2, 400 (doesn't even reach
    // the ownership check).
    const res = await postMerge({ transcriptionIds: ["n1", "n1", "n1"] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/notes/merge — cap de uso diario", () => {
  it("429 cuando el trigger rechaza por límite diario de merge", async () => {
    mockUser(createFakeSupabase({ usageLogInsert: { error: { message: "ai_merge_daily_limit_reached" } } }));
    mockStreamTextResult();
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(429);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("503 (fail-closed) ante un error real al reservar cuota", async () => {
    mockUser(createFakeSupabase({ usageLogInsert: { error: { message: "connection reset" } } }));
    mockStreamTextResult();
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(503);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("degrada sin cap (sigue) cuando ai_usage_log todavía no existe (42P01)", async () => {
    mockUser(
      createFakeSupabase({
        usageLogInsert: { error: { message: 'relation "ai_usage_log" does not exist', code: "42P01" } },
      })
    );
    mockStreamTextResult();
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });
});

describe("POST /api/notes/merge — generación", () => {
  it("400 si las notas elegidas no tienen contenido para unir", async () => {
    const supabase = createFakeSupabase({
      notes: {
        data: [
          { id: "n1", title: "Vacía 1", text: "", created_at: "2026-07-01T00:00:00.000Z" },
          { id: "n2", title: "Vacía 2", text: "   ", created_at: "2026-07-02T00:00:00.000Z" },
        ],
        error: null,
      },
    });
    mockUser(supabase);
    const res = await postMerge({ transcriptionIds: ["n1", "n2"] });
    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("200 y llama a streamText con el modelo de merge cuando todo es válido", async () => {
    mockUser(createFakeSupabase({}));
    mockStreamTextResult();
    const res = await postMerge({ transcriptionIds: ["n1", "n2"], instruction: "armá un brief" });
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
    const call = vi.mocked(streamText).mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("armá un brief");
  });
});
