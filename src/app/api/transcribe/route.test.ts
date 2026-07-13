import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `getApiUser` hace I/O real (cookies/JWT) — se mockea para inyectar un usuario fijo y un cliente
// Supabase falso controlado por cada test, mismo patrón que `api/chat/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

// `generateText` (usado por `applyRecipeText`, ver `src/lib/recipes/apply.ts`) hace red real hacia
// Groq — se mockea para poder testear el auto-apply del Formato default EN el flujo completo de
// `/api/transcribe` sin llamar a un LLM de verdad. `streamText` no se usa en esta route pero se
// preserva el resto del módulo real (`AbortSignal`, etc. no vienen de acá).
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

vi.mock("@ai-sdk/groq", () => ({
  groq: vi.fn(() => ({ __fakeGroqModel: true })),
}));

import { getApiUser } from "@/lib/supabase/api";
import { generateText } from "ai";
import { POST } from "./route";

type Nullable<T> = T | null;
type ErrorLike = { message: string; code?: string } | null;

type AiRecipeRow = { id: string; name: string; instruction: string };

/** Fake table para `transcriptions`: distingue el SELECT de conteo diario (`{count,head}` en las
 * opciones) del SELECT de dedupe (sin esas opciones) por forma de los argumentos — mismo criterio de
 * "solo lo que esta route realmente llama" que ya usan `api/chat/route.test.ts`/`api/notes/route.test.ts`. */
function createTranscriptionsTable(options: {
  dailyCount?: { count: Nullable<number>; error: ErrorLike };
  dedupe?: { data: unknown; error: ErrorLike };
  insertResult?: { data: Nullable<{ id: string }>; error: ErrorLike };
}) {
  const dailyCount = options.dailyCount ?? { count: 0, error: null };
  const dedupe = options.dedupe ?? { data: null, error: null };
  const insertResult = options.insertResult ?? { data: { id: "t1" }, error: null };
  const insertCalls: Record<string, unknown>[] = [];

  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      if (opts && opts.count) {
        return { eq: () => ({ gte: () => Promise.resolve(dailyCount) }) };
      }
      const chain = {
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(dedupe),
      };
      return chain;
    },
    insert(payload: Record<string, unknown>) {
      insertCalls.push(payload);
      return { select: () => ({ single: () => Promise.resolve(insertResult) }) };
    },
    insertCalls,
  };
}

function createAiRecipesTable(result: { data: Nullable<AiRecipeRow>; error: ErrorLike }) {
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: () => Promise.resolve(result),
  };
  return table;
}

function createVocabularyTermsTable() {
  const table = {
    select: () => table,
    eq: () => table,
    order: () =>
      Promise.resolve({ data: null, error: { message: 'relation "vocabulary_terms" does not exist', code: "42P01" } }),
  };
  return table;
}

function createMockSupabase(options: {
  transcriptions?: Parameters<typeof createTranscriptionsTable>[0];
  aiRecipe?: { data: Nullable<AiRecipeRow>; error: ErrorLike };
  usageLogInsert?: { error: ErrorLike };
}) {
  const transcriptions = createTranscriptionsTable(options.transcriptions ?? {});
  const aiRecipes = createAiRecipesTable(options.aiRecipe ?? { data: null, error: null });
  const usageLogResult = options.usageLogInsert ?? { error: null };
  const usageLogInsertCalls: Record<string, unknown>[] = [];
  const vocabularyTerms = createVocabularyTermsTable();

  const supabase = {
    from(table: string) {
      if (table === "transcriptions") return transcriptions;
      if (table === "ai_recipes") return aiRecipes;
      if (table === "vocabulary_terms") return vocabularyTerms;
      if (table === "ai_usage_log") {
        return {
          insert(payload: Record<string, unknown>) {
            usageLogInsertCalls.push(payload);
            return Promise.resolve(usageLogResult);
          },
        };
      }
      throw new Error(`Tabla inesperada en el test: ${table}`);
    },
    storage: {
      from: () => ({ upload: () => Promise.resolve({ error: null }) }),
    },
  };

  return { supabase, transcriptions, usageLogInsertCalls };
}

function mockUser(supabase: unknown) {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });
}

/** Texto de Whisper deliberadamente CORTO (< `MIN_TITLE_TAGS_TEXT_LENGTH = 12`, ver
 * `src/lib/titleTags/validate.ts`) para que el paso de auto-título/auto-tags se salte solo (sin
 * necesidad de mockear ESE fetch aparte) — así el único fetch real que hace falta interceptar es el
 * de transcripción de Groq. */
const GROQ_TRANSCRIBED_TEXT = "Hola mundo";

function postTranscribe() {
  const form = new FormData();
  form.append("file", new File(["fake-audio-bytes"], "audio.webm", { type: "audio/webm" }));
  form.append("language", "es");
  const req = new Request("http://localhost/api/transcribe", { method: "POST", body: form });
  return POST(req as never);
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
  vi.mocked(generateText).mockReset();
  process.env.GROQ_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.includes("audio/transcriptions")) {
        return new Response(JSON.stringify({ text: GROQ_TRANSCRIBED_TEXT }), { status: 200 });
      }
      throw new Error(`fetch inesperado en el test: ${String(url)}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const defaultRecipe: AiRecipeRow = { id: "r1", name: "Brief de producción", instruction: "Convertí a brief." };

describe("POST /api/transcribe — auto-apply del Formato default", () => {
  it("aplica el formato default y persiste output+nombre en el insert de la transcripción", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "Brief generado con éxito." } as never);
    const { supabase, transcriptions, usageLogInsertCalls } = createMockSupabase({ aiRecipe: { data: defaultRecipe, error: null } });
    mockUser(supabase);

    const res = await postTranscribe();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("t1");
    expect(transcriptions.insertCalls).toHaveLength(1);
    expect(transcriptions.insertCalls[0].default_recipe_output).toBe("Brief generado con éxito.");
    expect(transcriptions.insertCalls[0].default_recipe_name).toBe("Brief de producción");
    expect(usageLogInsertCalls.some((c) => (c as { kind?: string }).kind === "recipe")).toBe(true);
  });

  it("si el modelo falla/tarda de más, la transcripción SE GUARDA IGUAL, sin resultado de formato", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("timeout"));
    const { supabase, transcriptions } = createMockSupabase({ aiRecipe: { data: defaultRecipe, error: null } });
    mockUser(supabase);

    const res = await postTranscribe();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("t1"); // la transcripción se guardó de todos modos
    expect(transcriptions.insertCalls).toHaveLength(1);
    expect(transcriptions.insertCalls[0].default_recipe_output).toBeNull();
    expect(transcriptions.insertCalls[0].default_recipe_name).toBeNull();
    // El texto transcripto sigue viajando en la respuesta, best-effort nunca se lo lleva puesto.
    expect(json.text).toBe(GROQ_TRANSCRIBED_TEXT);
  });

  it("si el cap diario de 'recipe' está alcanzado, no llama al modelo y la transcripción se guarda sin formato", async () => {
    const { supabase, transcriptions } = createMockSupabase({
      aiRecipe: { data: defaultRecipe, error: null },
      usageLogInsert: { error: { message: "ai_recipe_daily_limit_reached" } },
    });
    mockUser(supabase);

    const res = await postTranscribe();

    expect(res.status).toBe(200);
    expect(generateText).not.toHaveBeenCalled();
    expect(transcriptions.insertCalls[0].default_recipe_output).toBeNull();
  });

  it("sin formato default, no se llama al modelo ni se toca ai_usage_log/columnas de formato", async () => {
    const { supabase, transcriptions, usageLogInsertCalls } = createMockSupabase({ aiRecipe: { data: null, error: null } });
    mockUser(supabase);

    const res = await postTranscribe();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(generateText).not.toHaveBeenCalled();
    expect(usageLogInsertCalls).toHaveLength(0); // ni siquiera el intento de reservar cuota
    expect(transcriptions.insertCalls[0].default_recipe_output).toBeNull();
    expect(transcriptions.insertCalls[0].default_recipe_name).toBeNull();
    expect(json.id).toBe("t1");
  });

  it("sin ningún formato en absoluto (tabla ai_recipes sin migrar, 42P01) igual guarda la transcripción", async () => {
    const { supabase, transcriptions } = createMockSupabase({
      aiRecipe: { data: null, error: { message: 'relation "ai_recipes" does not exist', code: "42P01" } },
    });
    mockUser(supabase);

    const res = await postTranscribe();

    expect(res.status).toBe(200);
    expect(generateText).not.toHaveBeenCalled();
    expect(transcriptions.insertCalls[0].default_recipe_output).toBeNull();
  });
});
