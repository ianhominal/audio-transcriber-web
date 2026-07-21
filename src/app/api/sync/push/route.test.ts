import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetSchemaCompatCacheForTests } from "@/lib/supabase/schema-compat";

// `getApiUser` hace I/O real (cookies/JWT) — se mockea para inyectar un usuario fijo y un
// cliente Supabase falso controlado por cada test (ver `createMockSupabase` más abajo).
vi.mock("@/lib/supabase/api", () => ({
  getApiUser: vi.fn(),
}));

import { getApiUser } from "@/lib/supabase/api";
import { POST } from "./route";

type QueryState = {
  table: string;
  mode: "select" | "update" | "upsert";
  columns?: string;
  countHead?: boolean;
  updatePayload?: Record<string, unknown>;
  filters: { eq: Record<string, unknown>; in: Record<string, unknown[]> };
};

type QueryResult = { data?: unknown; error?: unknown; count?: number };

/**
 * Cliente Supabase falso: en vez de encolar respuestas por posición (frágil ante cambios de
 * orden), arma un builder que registra QUÉ se pidió (tabla, modo select/update, columnas,
 * filtros) y recién al `await` (`.then`) resuelve consultando `resolver(state)` — así el test
 * describe el comportamiento por QUERY, no por índice de llamada.
 */
function createMockSupabase(resolver: (state: QueryState) => QueryResult, calls: QueryState[]) {
  return {
    from(table: string) {
      const state: QueryState = { table, mode: "select", filters: { eq: {}, in: {} } };
      const builder = {
        select(columns?: string, opts?: { count?: string; head?: boolean }) {
          state.columns = columns;
          if (opts?.head) state.countHead = true;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          state.mode = "update";
          state.updatePayload = payload;
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          state.mode = "upsert";
          state.updatePayload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters.eq[col] = val;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          state.filters.in[col] = vals;
          return builder;
        },
        is() {
          return builder;
        },
        single() {
          return builder;
        },
        then(resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) {
          calls.push(state);
          return Promise.resolve(resolver(state)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

/** Jerarquía compartida por los tests: root → child1 (subárbol), leaf2 suelto. */
const PROJECT_LINKS = [
  { id: "root", parent_project_id: null },
  { id: "child1", parent_project_id: "root" },
  { id: "leaf2", parent_project_id: null },
];

function postPush(body: unknown) {
  const req = new Request("http://localhost/api/sync/push", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

beforeEach(() => {
  resetSchemaCompatCacheForTests();
  vi.mocked(getApiUser).mockReset();
});

describe("POST /api/sync/push — borrado de proyectos", () => {
  it("borrado de una hoja (sin descendientes) no cambia de comportamiento (regresión)", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "projects" && state.mode === "select") {
        return { data: PROJECT_LINKS, error: null };
      }
      if (state.table === "transcriptions" && state.mode === "update") {
        expect(state.filters.in.project_id).toEqual(["leaf2"]);
        return { data: [{ id: "t1" }], error: null };
      }
      if (state.table === "projects" && state.mode === "update") {
        expect(state.filters.in.id).toEqual(["leaf2"]);
        return { data: [{ id: "leaf2" }], error: null };
      }
      throw new Error(`Query inesperada: ${state.table}/${state.mode}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({ projects: { deletes: ["leaf2"] } });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.errors).toEqual([]);
    expect(json.projectDeletions).toEqual([{ id: "leaf2", deletedProjects: 1, deletedTranscriptions: 1 }]);
  });

  it("borrado con descendientes SIN confirmar: rechazado, error en errors[], nada se borra", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "projects" && state.mode === "select") {
        return { data: PROJECT_LINKS, error: null };
      }
      if (state.table === "transcriptions" && state.countHead) {
        expect(Array.from(state.filters.in.project_id).sort()).toEqual(["child1", "root"]);
        return { data: null, count: 5, error: null };
      }
      throw new Error(`Query inesperada (no debería ejecutarse ningún borrado): ${state.table}/${state.mode}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({ projects: { deletes: ["root"] } });
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toMatch(/root/);
    expect(json.errors[0]).toMatch(/1 subproyecto/);
    expect(json.errors[0]).toMatch(/5 transcripci/);
    expect(json.projectDeletions).toEqual([]);
    // Ningún update (borrado) se disparó contra projects/transcriptions.
    expect(calls.some((c) => c.mode === "update")).toBe(false);
  });

  it("borrado con descendientes CONFIRMADO (cascadeDeletes): cascadea y la respuesta trae los conteos", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "projects" && state.mode === "select") {
        return { data: PROJECT_LINKS, error: null };
      }
      if (state.table === "transcriptions" && state.mode === "update") {
        expect(Array.from(state.filters.in.project_id).sort()).toEqual(["child1", "root"]);
        return { data: [{ id: "t1" }, { id: "t2" }, { id: "t3" }], error: null };
      }
      if (state.table === "projects" && state.mode === "update") {
        expect(Array.from(state.filters.in.id).sort()).toEqual(["child1", "root"]);
        return { data: [{ id: "root" }, { id: "child1" }], error: null };
      }
      throw new Error(`Query inesperada: ${state.table}/${state.mode}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({ projects: { deletes: ["root"], cascadeDeletes: ["root"] } });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.errors).toEqual([]);
    expect(json.projectDeletions).toEqual([{ id: "root", deletedProjects: 2, deletedTranscriptions: 3 }]);
  });

  it("un borrado bloqueado no frena el resto del batch (otro delete de proyecto + un delete de transcripción)", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "projects" && state.mode === "select") {
        return { data: PROJECT_LINKS, error: null };
      }
      if (state.table === "transcriptions" && state.countHead) {
        return { data: null, count: 5, error: null }; // conteo para "root" bloqueado
      }
      if (state.table === "transcriptions" && state.mode === "update" && state.filters.in.project_id) {
        expect(state.filters.in.project_id).toEqual(["leaf2"]);
        return { data: [{ id: "t9" }], error: null };
      }
      if (state.table === "projects" && state.mode === "update") {
        expect(state.filters.in.id).toEqual(["leaf2"]);
        return { data: [{ id: "leaf2" }], error: null };
      }
      if (state.table === "transcriptions" && state.mode === "update" && state.filters.eq.id === "tx-suelta") {
        return { data: null, error: null };
      }
      throw new Error(`Query inesperada: ${state.table}/${state.mode}/${JSON.stringify(state.filters)}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({
      projects: { deletes: ["root", "leaf2"] },
      transcriptions: { deletes: ["tx-suelta"] },
    });
    const json = await res.json();

    expect(json.ok).toBe(false); // "root" quedó bloqueado, así que hay 1 error
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toMatch(/root/);
    expect(json.projectDeletions).toEqual([{ id: "leaf2", deletedProjects: 1, deletedTranscriptions: 1 }]);
  });
});

describe("POST /api/sync/push — upsert de transcripciones", () => {
  it("con audio_name: upsert REAL (crea-o-actualiza), con user_id y audio_name en la fila", async () => {
    // Bug de pérdida silenciosa: antes esto era un UPDATE que, para una transcripción 100% local
    // (nunca creada por Groq), no tocaba ninguna fila y respondía ok sin persistir nada.
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "transcriptions" && state.mode === "upsert") return { data: null, error: null };
      throw new Error(`Query inesperada: ${state.table}/${state.mode}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({
      transcriptions: { upserts: [{ id: "t1", audio_name: "Reunion.wav", text: "Persona 1: hola", project_id: "p1" }] },
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.errors).toEqual([]);
    const upsertCall = calls.find((c) => c.table === "transcriptions" && c.mode === "upsert");
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.updatePayload).toMatchObject({
      id: "t1",
      user_id: "u1",
      audio_name: "Reunion.wav",
      text: "Persona 1: hola",
      project_id: "p1",
      deleted_at: null,
    });
    // NUNCA debe caer al update-only (que no crearía la fila 100% local).
    expect(calls.some((c) => c.table === "transcriptions" && c.mode === "update")).toBe(false);
  });

  it("sin audio_name (cliente viejo): update-only scopeado por user, no intenta crear", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.table === "transcriptions" && state.mode === "update") return { data: null, error: null };
      throw new Error(`Query inesperada: ${state.table}/${state.mode}`);
    }, calls);
    vi.mocked(getApiUser).mockResolvedValue({ supabase: supabase as never, user: { id: "u1" } as never });

    const res = await postPush({ transcriptions: { upserts: [{ id: "t1", text: "editado" }] } });
    const json = await res.json();

    expect(json.ok).toBe(true);
    const updateCall = calls.find((c) => c.table === "transcriptions" && c.mode === "update");
    expect(updateCall).toBeDefined();
    expect(updateCall!.filters.eq).toMatchObject({ id: "t1", user_id: "u1" });
    expect(calls.some((c) => c.mode === "upsert")).toBe(false);
  });
});
