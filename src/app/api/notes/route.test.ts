import { describe, it, expect, beforeEach, vi } from "vitest";

// `getApiUser` hace I/O real (cookies/JWT) — mockeado para inyectar un usuario fijo y un cliente
// Supabase falso controlado por cada test, mismo patrón que `api/mcp-tokens/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { DAILY_LIMIT } from "@/lib/rateLimit";
import { POST } from "./route";

type InsertResult = { data: { id: string } | null; error: { message: string; code?: string } | null };
type DailyCountResult = { count: number | null; error: { message: string; code?: string } | null };

/**
 * Fake Supabase client: cubre `insert().select().single()` (la forma que usa el guardado de la nota)
 * y `select("id", {count,head}).eq().gte()` (el chequeo de límite diario compartido con
 * `/api/transcribe` — misma distinción por forma de los argumentos que
 * `api/transcribe/route.test.ts`). Soporta devolver resultados DISTINTOS en sucesivas llamadas al
 * insert (`insertResults`, consumidos en orden) para poder testear la cascada de compat de `tags`
 * (42703 → reintento sin esa columna). `dailyCount` default `{count: 0, error: null}` para no romper
 * los tests que no le pasan nada explícito.
 */
function createFakeSupabase(
  insertResults: InsertResult[],
  dailyCount: DailyCountResult = { count: 0, error: null }
) {
  const insertCalls: Record<string, unknown>[] = [];
  let call = 0;

  return {
    from(table: string) {
      if (table !== "transcriptions") throw new Error(`Unexpected table in test: ${table}`);
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts && opts.count) {
            return { eq: () => ({ gte: () => Promise.resolve(dailyCount) }) };
          }
          throw new Error("Unexpected select shape in test");
        },
        insert(payload: Record<string, unknown>) {
          insertCalls.push(payload);
          const result = insertResults[Math.min(call, insertResults.length - 1)];
          call++;
          return {
            select() {
              return { single: () => Promise.resolve(result) };
            },
          };
        },
      };
    },
    insertCalls,
  };
}

function mockUser(supabase: ReturnType<typeof createFakeSupabase>, userId = "u1") {
  vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: userId } as never });
}

function postNotes(body: unknown) {
  const req =
    typeof body === "string"
      ? new Request("http://localhost/api/notes", { method: "POST", body })
      : new Request("http://localhost/api/notes", { method: "POST", body: JSON.stringify(body) });
  return POST(req as never);
}

beforeEach(() => {
  vi.mocked(getApiUser).mockReset();
});

describe("POST /api/notes — auth and validation", () => {
  it("401 sin sesión", async () => {
    vi.mocked(getApiUser).mockResolvedValue({ supabase: {} as never, user: null });
    const res = await postNotes({ text: "hola" });
    expect(res.status).toBe(401);
  });

  it("400 con body no-JSON", async () => {
    mockUser(createFakeSupabase([]));
    const res = await postNotes("not-json");
    expect(res.status).toBe(400);
  });

  it("400 si el texto está vacío", async () => {
    mockUser(createFakeSupabase([]));
    const res = await postNotes({ text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/notes — creación", () => {
  it("crea la nota con el user_id del usuario autenticado (nunca uno del body)", async () => {
    const supabase = createFakeSupabase([{ data: { id: "note-1" }, error: null }]);
    mockUser(supabase, "u1");

    const res = await postNotes({ text: "Contenido de la respuesta", userId: "u-attacker" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("note-1");

    expect(supabase.insertCalls).toHaveLength(1);
    const payload = supabase.insertCalls[0];
    expect(payload.user_id).toBe("u1");
    expect(payload.audio_url).toBeNull();
    expect(payload.audio_size).toBe(0);
    expect(payload.tags).toEqual(["chat"]);
    expect(payload.title).toBe("Contenido de la respuesta");
  });

  it("cae en cascada sin `tags` si esa columna todavía no existe (42703)", async () => {
    const supabase = createFakeSupabase([
      { data: null, error: { message: "column transcriptions.tags does not exist", code: "42703" } },
      { data: { id: "note-2" }, error: null },
    ]);
    mockUser(supabase);

    const res = await postNotes({ text: "Texto sin tags" });
    expect(res.status).toBe(200);
    expect(supabase.insertCalls).toHaveLength(2);
    expect(supabase.insertCalls[0]).toHaveProperty("tags");
    expect(supabase.insertCalls[1]).not.toHaveProperty("tags");
  });

  it("500 ante un error real de inserción (no lo disfraza de 400)", async () => {
    const supabase = createFakeSupabase([{ data: null, error: { message: "connection reset" } }]);
    mockUser(supabase);
    const res = await postNotes({ text: "algo" });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/notes — límite diario compartido con /api/transcribe", () => {
  it("429 si ya alcanzó el límite diario (misma cuota que /api/transcribe)", async () => {
    const supabase = createFakeSupabase(
      [{ data: { id: "note-x" }, error: null }],
      { count: DAILY_LIMIT, error: null }
    );
    mockUser(supabase);

    const res = await postNotes({ text: "algo" });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("Llegaste al límite diario de transcripciones. Probá mañana o escribinos.");
    expect(supabase.insertCalls).toHaveLength(0);
  });

  it("503 si falla la query de conteo diario (fail-closed, no asume 0 consumido)", async () => {
    const supabase = createFakeSupabase(
      [{ data: { id: "note-x" }, error: null }],
      { count: null, error: { message: "connection reset" } }
    );
    mockUser(supabase);

    const res = await postNotes({ text: "algo" });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("No pudimos verificar tu límite diario. Probá de nuevo.");
    expect(supabase.insertCalls).toHaveLength(0);
  });

  it("guarda la nota normalmente si está bajo el límite diario", async () => {
    const supabase = createFakeSupabase(
      [{ data: { id: "note-y" }, error: null }],
      { count: DAILY_LIMIT - 1, error: null }
    );
    mockUser(supabase);

    const res = await postNotes({ text: "algo bajo el límite" });
    expect(res.status).toBe(200);
    expect(supabase.insertCalls).toHaveLength(1);
  });

  it("400 por texto vacío sigue ganando sobre el chequeo de límite diario (ni siquiera lo consulta)", async () => {
    const supabase = createFakeSupabase(
      [{ data: { id: "note-z" }, error: null }],
      { count: DAILY_LIMIT, error: null }
    );
    mockUser(supabase);

    const res = await postNotes({ text: "   " });
    expect(res.status).toBe(400);
  });
});
