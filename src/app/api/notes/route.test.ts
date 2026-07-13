import { describe, it, expect, beforeEach, vi } from "vitest";

// `getApiUser` hace I/O real (cookies/JWT) — mockeado para inyectar un usuario fijo y un cliente
// Supabase falso controlado por cada test, mismo patrón que `api/mcp-tokens/route.test.ts`.
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { POST } from "./route";

type InsertResult = { data: { id: string } | null; error: { message: string; code?: string } | null };

/**
 * Fake Supabase client: solo cubre `insert().select().single()` — la única forma que usa este
 * route. Soporta devolver resultados DISTINTOS en sucesivas llamadas (`insertResults`, consumidos
 * en orden) para poder testear la cascada de compat de `tags` (42703 → reintento sin esa columna).
 */
function createFakeSupabase(insertResults: InsertResult[]) {
  const insertCalls: Record<string, unknown>[] = [];
  let call = 0;

  return {
    from(table: string) {
      if (table !== "transcriptions") throw new Error(`Unexpected table in test: ${table}`);
      return {
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
