import { describe, it, expect, beforeEach, vi } from "vitest";

// `getApiUser` hace I/O real (cookies/JWT) — se mockea para inyectar un usuario fijo y un cliente
// Supabase falso controlado por cada test, mismo patrón que `api/chat/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

// `streamText` hace red real hacia Groq — se mockea para poder testear la lógica de
// auth/retrieval/scope/cap del route SIN llamar a un LLM de verdad.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock("@ai-sdk/groq", () => ({
  groq: vi.fn(() => ({ __fakeGroqModel: true })),
}));

import { getApiUser } from "@/lib/supabase/api";
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { POST } from "./route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };
type Call = [string, unknown[]];

/** Query builder falso genérico: registra cada método encadenado en `calls` y resuelve el
 * `result` dado en el método TERMINAL de cada camino real del route (`limit` para las 3 consultas
 * de `transcriptions`, `maybeSingle` para la de `projects`). Mismo criterio de mock que
 * `api/chat/route.test.ts` (`createTranscriptionsQuery`/`createChatMessagesTable`): un objeto que
 * se devuelve a sí mismo en cada método intermedio. */
function createQuery(result: QueryResult, calls: Call[]) {
  const q = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      return q;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return q;
    },
    is(...args: unknown[]) {
      calls.push(["is", args]);
      return q;
    },
    textSearch(...args: unknown[]) {
      calls.push(["textSearch", args]);
      return q;
    },
    or(...args: unknown[]) {
      calls.push(["or", args]);
      return q;
    },
    order(...args: unknown[]) {
      calls.push(["order", args]);
      return q;
    },
    limit(...args: unknown[]) {
      calls.push(["limit", args]);
      return Promise.resolve(result);
    },
    maybeSingle() {
      calls.push(["maybeSingle", []]);
      return Promise.resolve(result);
    },
  };
  return q;
}

const NOTE_ROW = { id: "n1", title: "Nota", text: "Contenido de la nota.", summary: null, created_at: "2026-07-20T10:00:00Z" };
// 3 filas alcanzan MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK (3) — evita que la consulta de "recent
// fallback" se dispare en los tests que no la ejercitan explícitamente.
const FTS_ROWS = [NOTE_ROW, { ...NOTE_ROW, id: "n2" }, { ...NOTE_ROW, id: "n3" }];

function createMockSupabase(options: {
  ftsResult?: QueryResult;
  projectResult?: QueryResult;
  usageLogInsert?: { error: { message: string; code?: string } | null };
}) {
  const ftsCalls: Call[] = [];
  const projectCalls: Call[] = [];
  const usageLogInsertCalls: unknown[] = [];
  let transcriptionsCallCount = 0;

  const ftsResult = options.ftsResult ?? { data: FTS_ROWS, error: null };
  const projectResult = options.projectResult ?? { data: { name: "Mi proyecto" }, error: null };
  const usageLogResult = options.usageLogInsert ?? { error: null };

  return {
    from(table: string) {
      if (table === "transcriptions") {
        transcriptionsCallCount += 1;
        // Todos los tests de este archivo ejercitan a lo sumo el camino FTS (el fallback ilike y
        // el de "recent notes" tienen su propia cobertura pura en `retrieval.test.ts`) — cualquier
        // consulta adicional a `transcriptions` reutiliza el mismo `ftsResult`.
        return createQuery(ftsResult, ftsCalls);
      }
      if (table === "projects") return createQuery(projectResult, projectCalls);
      if (table === "ai_usage_log") {
        return {
          insert(payload: unknown) {
            usageLogInsertCalls.push(payload);
            return Promise.resolve(usageLogResult);
          },
        };
      }
      throw new Error(`Tabla inesperada: ${table}`);
    },
    ftsCalls,
    projectCalls,
    usageLogInsertCalls,
    transcriptionsCallCount: () => transcriptionsCallCount,
  };
}

function mockUser(supabase: ReturnType<typeof createMockSupabase>) {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });
}

function postBrain(body: unknown) {
  const req = new Request("http://localhost/api/brain", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

const validMessage = { id: "m1", role: "user", parts: [{ type: "text", text: "¿Qué dije sobre esto?" }] };

function mockStreamTextResult() {
  const toUIMessageStreamResponse = vi.fn(() => new Response(null, { status: 200 }));
  const consumeStream = vi.fn();
  vi.mocked(streamText).mockReturnValue({ toUIMessageStreamResponse, consumeStream } as never);
  return { toUIMessageStreamResponse, consumeStream };
}

function hasEqCall(calls: Call[], column: string, value: unknown): boolean {
  return calls.some(([method, args]) => method === "eq" && args[0] === column && args[1] === value);
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(streamText).mockReset();
  vi.mocked(groq).mockClear();
  process.env.GROQ_API_KEY = "test-key";
});

describe("POST /api/brain — scope 'project': validación de projectId", () => {
  it("400 cuando projectId no es un UUID válido — no llega a tocar Supabase", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: "no-es-un-uuid" });

    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
    expect(supabase.transcriptionsCallCount()).toBe(0);
  });

  it("400 cuando projectId es de un tipo inválido (no-string)", async () => {
    mockUser(createMockSupabase({}));
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: 12345 });

    expect(res.status).toBe(400);
  });

  it("no rechaza cuando projectId viene null — se trata como ausente", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: null });

    expect(res.status).toBe(200);
    expect(supabase.ftsCalls.some(([method, args]) => method === "eq" && args[0] === "project_id")).toBe(false);
  });
});

describe("POST /api/brain — scope 'project': projectId válido acota la búsqueda", () => {
  it("aplica .eq('project_id', projectId) en la consulta FTS principal", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(200);
    expect(hasEqCall(supabase.ftsCalls, "project_id", "11111111-1111-4111-8111-111111111111")).toBe(true);
    // Team Sharing slice 1b, Phase 14: la sesión autenticada (`getApiUser`) sigue siendo la ÚNICA
    // fuente de identidad, pero ya NO se agrega un `.eq("user_id", ...)` — la RLS de
    // `transcriptions: read` ya resuelve "propia O de un proyecto compartido accesible", y
    // reintroducir el filtro acá ocultaría las notas compartidas de un viewer (ver siguiente bloque).
    expect(hasEqCall(supabase.ftsCalls, "user_id", "u1")).toBe(false);
  });

  it("acepta un id estilo desktop (HashId) con nibble de versión fuera de RFC (bugfix 2026-07-22)", async () => {
    // z.uuid() estricto rechazaba estos ids VÁLIDOS-para-Postgres que genera el cliente desktop
    // (nibble de versión 0/9 por el layout mixed-endian de .NET Guid), rompiendo el "Asistente del
    // proyecto" con "El proyecto indicado no es válido". El chequeo de forma (regex) los acepta.
    const desktopId = "c1b6bf10-83c6-0947-aa9d-b6ba0747478a"; // nibble de versión = 0 (no RFC)
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: desktopId });

    expect(res.status).toBe(200);
    expect(hasEqCall(supabase.ftsCalls, "project_id", desktopId)).toBe(true);
  });

  it("busca el nombre del proyecto SOLO por id — sin filtro user_id, deja que la RLS decida si es accesible (Phase 14)", async () => {
    const supabase = createMockSupabase({ projectResult: { data: { name: "Proyecto Test" }, error: null } });
    mockUser(supabase);
    mockStreamTextResult();

    await postBrain({ message: validMessage, projectId: "11111111-1111-4111-8111-111111111111" });

    expect(hasEqCall(supabase.projectCalls, "id", "11111111-1111-4111-8111-111111111111")).toBe(true);
    // Sin esto, un viewer nunca podría resolver el nombre de un proyecto compartido (pertenece a
    // otro user_id) — vería el id crudo en el prompt, el problema que ADR-05 marca explícitamente.
    expect(hasEqCall(supabase.projectCalls, "user_id", "u1")).toBe(false);
    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.system).toContain("Proyecto Test");
  });

  it("sigue funcionando (best-effort) si la búsqueda del nombre del proyecto falla", async () => {
    const supabase = createMockSupabase({ projectResult: { data: null, error: { message: "connection reset" } } });
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage, projectId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });
});

describe("POST /api/brain — sin projectId: comportamiento sin cambios", () => {
  it("no agrega ningún filtro por project_id en la consulta FTS", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage });

    expect(res.status).toBe(200);
    expect(supabase.ftsCalls.some(([method, args]) => method === "eq" && args[0] === "project_id")).toBe(false);
  });

  it("no consulta la tabla 'projects' cuando no hay projectId", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    await postBrain({ message: validMessage });

    expect(supabase.projectCalls).toHaveLength(0);
  });

  it("llama a streamText con el modelo y el cap de tokens de salida, igual que antes", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage });

    expect(res.status).toBe(200);
    expect(groq).toHaveBeenCalled();
    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("POST /api/brain — Team Sharing slice 1b, Phase 14: CRÍTICO-2 aplicado a /api/brain (ADR-05)", () => {
  it("el fallback de notas recientes tampoco filtra por user_id — RLS decide, igual que la consulta FTS principal", async () => {
    // Menos de MIN_RETRIEVAL_RESULTS_BEFORE_FALLBACK (3) filas dispara la query de "recent notes".
    const supabase = createMockSupabase({ ftsResult: { data: [NOTE_ROW], error: null } });
    mockUser(supabase);
    mockStreamTextResult();

    const res = await postBrain({ message: validMessage });

    expect(res.status).toBe(200);
    expect(supabase.transcriptionsCallCount()).toBe(2); // FTS + recent fallback
    expect(hasEqCall(supabase.ftsCalls, "user_id", "u1")).toBe(false);
  });

  it("regresión — ninguna de las consultas a transcriptions/projects agrega un filtro user_id", async () => {
    const supabase = createMockSupabase({});
    mockUser(supabase);
    mockStreamTextResult();

    await postBrain({ message: validMessage, projectId: "11111111-1111-4111-8111-111111111111" });

    const eqCalls = [...supabase.ftsCalls, ...supabase.projectCalls].filter(([method]) => method === "eq");
    expect(eqCalls.some(([, args]) => args[0] === "user_id")).toBe(false);
  });
});
