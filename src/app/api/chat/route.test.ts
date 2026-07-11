import { describe, it, expect, beforeEach, vi } from "vitest";

// `getApiUser` hace I/O real (cookies/JWT) — se mockea para inyectar un usuario fijo y un cliente
// Supabase falso controlado por cada test, mismo patrón que `api/sync/push/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

// `streamText`/`convertToModelMessages` hacen red real hacia Groq — se mockean para poder testear
// la lógica de auth/ownership/cap/persistencia del route SIN llamar a un LLM de verdad.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn(), convertToModelMessages: vi.fn() };
});

vi.mock("@ai-sdk/groq", () => ({
  groq: vi.fn(() => ({ __fakeGroqModel: true })),
}));

import { getApiUser } from "@/lib/supabase/api";
import { streamText, convertToModelMessages } from "ai";
import { groq } from "@ai-sdk/groq";
import { CHAT_MODEL } from "@/lib/chat/config";
import { POST } from "./route";

type TranscriptionResult = { data: { id: string; text: string | null } | null; error: { message: string } | null };
type InsertResult = { error: { message: string; code?: string } | null };

function createTranscriptionsQuery(result: TranscriptionResult) {
  const q = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    is() {
      return q;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  return q;
}

function createMockSupabase(options: {
  transcription?: TranscriptionResult;
  usageLogInsert?: InsertResult;
  chatInsert?: InsertResult;
}) {
  const chatInsertCalls: unknown[][] = [];
  const usageLogInsertCalls: unknown[] = [];

  const transcriptionResult = options.transcription ?? {
    data: { id: "t1", text: "Este es el texto de la transcripción." },
    error: null,
  };
  const usageLogResult = options.usageLogInsert ?? { error: null };
  const chatInsertResult = options.chatInsert ?? { error: null };

  return {
    from(table: string) {
      if (table === "transcriptions") return createTranscriptionsQuery(transcriptionResult);
      if (table === "ai_usage_log") {
        return {
          insert(payload: unknown) {
            usageLogInsertCalls.push(payload);
            return Promise.resolve(usageLogResult);
          },
        };
      }
      if (table === "chat_messages") {
        return {
          insert(rows: unknown[]) {
            chatInsertCalls.push(rows);
            return Promise.resolve(chatInsertResult);
          },
        };
      }
      throw new Error(`Tabla inesperada: ${table}`);
    },
    chatInsertCalls,
    usageLogInsertCalls,
  };
}

function mockUser(supabase: ReturnType<typeof createMockSupabase>) {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });
}

function postChat(body: unknown) {
  const req = new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

const validMessages = [{ id: "m1", role: "user", parts: [{ type: "text", text: "¿De qué habla esto?" }] }];

/** Captura las opciones (`onFinish`/`onError`) pasadas a `toUIMessageStreamResponse` para poder
 * invocarlas manualmente y testear la persistencia/el masking de errores. */
function mockStreamTextResult() {
  let capturedOptions: {
    onFinish?: (event: { responseMessage: unknown }) => unknown;
    onError?: (error: unknown) => string;
  } = {};
  const toUIMessageStreamResponse = vi.fn((opts) => {
    capturedOptions = opts;
    return new Response(null, { status: 200 });
  });
  const consumeStream = vi.fn();
  vi.mocked(streamText).mockReturnValue({ toUIMessageStreamResponse, consumeStream } as never);
  return { getCaptured: () => capturedOptions, toUIMessageStreamResponse, consumeStream };
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(streamText).mockReset();
  vi.mocked(convertToModelMessages).mockReset();
  vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: "¿De qué habla esto?" }] as never);
  vi.mocked(groq).mockClear();
  process.env.GROQ_API_KEY = "test-key";
});

describe("POST /api/chat — auth y validación", () => {
  it("401 sin sesión", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(401);
  });

  it("500 sin GROQ_API_KEY configurada", async () => {
    delete process.env.GROQ_API_KEY;
    mockUser(createMockSupabase({}));
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(500);
  });

  it("400 con body no-JSON", async () => {
    mockUser(createMockSupabase({}));
    const req = new Request("http://localhost/api/chat", { method: "POST", body: "no-es-json" });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("400 sin transcriptionId", async () => {
    mockUser(createMockSupabase({}));
    const res = await postChat({ messages: validMessages });
    expect(res.status).toBe(400);
  });

  it("400 con messages vacío o ausente", async () => {
    mockUser(createMockSupabase({}));
    expect((await postChat({ transcriptionId: "t1", messages: [] })).status).toBe(400);
    expect((await postChat({ transcriptionId: "t1" })).status).toBe(400);
  });

  it("400 cuando el último mensaje no es del usuario", async () => {
    mockUser(createMockSupabase({}));
    const res = await postChat({
      transcriptionId: "t1",
      messages: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "hola" }] }],
    });
    expect(res.status).toBe(400);
  });

  it("400 cuando el mensaje del usuario está vacío", async () => {
    mockUser(createMockSupabase({}));
    const res = await postChat({
      transcriptionId: "t1",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "   " }] }],
    });
    expect(res.status).toBe(400);
  });

  it("400 cuando el mensaje del usuario excede el cap de largo", async () => {
    mockUser(createMockSupabase({}));
    const res = await postChat({
      transcriptionId: "t1",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "a".repeat(5_000) }] }],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat — ownership de la transcripción", () => {
  it("404 cuando la transcripción no existe o es de otro usuario (RLS)", async () => {
    mockUser(createMockSupabase({ transcription: { data: null, error: null } }));
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(404);
  });

  it("500 ante un error real de la query (no lo disfraza de 404)", async () => {
    mockUser(createMockSupabase({ transcription: { data: null, error: { message: "connection reset" } } }));
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(500);
  });

  it("400 cuando la transcripción todavía no tiene texto", async () => {
    mockUser(createMockSupabase({ transcription: { data: { id: "t1", text: "" }, error: null } }));
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(400);
  });

  it("no filtra el error crudo de la DB en la respuesta al cliente", async () => {
    mockUser(createMockSupabase({ transcription: { data: null, error: { message: "secret db detail" } } }));
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("secret db detail");
  });
});

describe("POST /api/chat — cap de uso diario", () => {
  it("429 cuando el trigger rechaza por límite diario de chat", async () => {
    mockUser(
      createMockSupabase({ usageLogInsert: { error: { message: "ai_chat_daily_limit_reached" } } })
    );
    mockStreamTextResult();
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(429);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("503 (fail-closed) ante un error real al reservar cuota", async () => {
    mockUser(createMockSupabase({ usageLogInsert: { error: { message: "connection reset" } } }));
    mockStreamTextResult();
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(503);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("degrada sin cap (sigue) cuando ai_usage_log todavía no existe (42P01)", async () => {
    mockUser(
      createMockSupabase({
        usageLogInsert: { error: { message: 'relation "ai_usage_log" does not exist', code: "42P01" } },
      })
    );
    mockStreamTextResult();
    const res = await postChat({ transcriptionId: "t1", messages: validMessages });
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });
});

describe("POST /api/chat — generación y streaming", () => {
  it("llama a streamText con el modelo de chat, el system prompt con el texto y el cap de tokens de salida", async () => {
    mockUser(
      createMockSupabase({ transcription: { data: { id: "t1", text: "Contenido puntual del audio." }, error: null } })
    );
    mockStreamTextResult();

    const res = await postChat({ transcriptionId: "t1", messages: validMessages });

    expect(res.status).toBe(200);
    expect(groq).toHaveBeenCalledWith(CHAT_MODEL);
    expect(convertToModelMessages).toHaveBeenCalledWith(validMessages);
    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.system).toContain("Contenido puntual del audio.");
    expect(call.maxOutputTokens).toBeGreaterThan(0);
  });

  it("persiste el mensaje del usuario y la respuesta del assistant juntos en onFinish", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    const { getCaptured } = mockStreamTextResult();

    await postChat({ transcriptionId: "t1", messages: validMessages });
    await getCaptured().onFinish?.({
      responseMessage: { id: "a1", role: "assistant", parts: [{ type: "text", text: "La respuesta del modelo." }] },
    });

    expect(supabase.chatInsertCalls).toHaveLength(1);
    const rows = supabase.chatInsertCalls[0] as Array<{ role: string; content: string }>;
    expect(rows).toEqual([
      { transcription_id: "t1", user_id: "u1", role: "user", content: "¿De qué habla esto?" },
      { transcription_id: "t1", user_id: "u1", role: "assistant", content: "La respuesta del modelo." },
    ]);
  });

  it("NO persiste nada si la respuesta del assistant quedó vacía (stream abortado sin texto)", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    const { getCaptured } = mockStreamTextResult();

    await postChat({ transcriptionId: "t1", messages: validMessages });
    await getCaptured().onFinish?.({ responseMessage: { id: "a1", role: "assistant", parts: [] } });

    expect(supabase.chatInsertCalls).toHaveLength(0);
  });

  it("onError nunca reenvía el error crudo — devuelve un mensaje genérico", async () => {
    mockUser(createMockSupabase({}));
    const { getCaptured } = mockStreamTextResult();

    await postChat({ transcriptionId: "t1", messages: validMessages });
    const masked = getCaptured().onError?.(new Error("groq: invalid api key xyz-secret"));

    expect(masked).not.toContain("xyz-secret");
    expect(typeof masked).toBe("string");
  });
});
