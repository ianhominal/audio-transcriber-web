import { describe, it, expect, beforeEach } from "vitest";
import {
  getDriveConnectionStatusCompat,
  markDriveConnectionRevoked,
  resetDriveConnectionStatusCacheForTests,
} from "./connection-status-compat";

type QueryState = {
  table: string;
  mode: "select" | "update";
  columns?: string;
  updatePayload?: Record<string, unknown>;
  filters: Record<string, unknown>;
};

type QueryResult = { data?: unknown; error?: unknown };

/** Cliente Supabase falso: arma un builder que registra qué se pidió y resuelve vía `resolver`,
 * mismo criterio que `src/app/api/sync/push/route.test.ts` (describe el comportamiento por
 * query, no por índice de llamada). */
function createMockSupabase(resolver: (state: QueryState) => QueryResult, calls: QueryState[] = []) {
  return {
    from(table: string) {
      const state: QueryState = { table, mode: "select", filters: {} };
      const builder = {
        select(columns?: string) {
          state.columns = columns;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          state.mode = "update";
          state.updatePayload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters[col] = val;
          return builder;
        },
        maybeSingle() {
          calls.push(state);
          return Promise.resolve(resolver(state));
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

const MISSING_COLUMN_ERROR = { code: "42703", message: 'column "status" of relation "drive_connections" does not exist' };

describe("getDriveConnectionStatusCompat", () => {
  beforeEach(() => {
    resetDriveConnectionStatusCacheForTests();
  });

  it("devuelve null si el usuario no tiene fila en drive_connections", async () => {
    const supabase = createMockSupabase(() => ({ data: null, error: null }));
    const status = await getDriveConnectionStatusCompat(supabase as never, "u1");
    expect(status).toBeNull();
  });

  it("devuelve 'active' cuando status = 'active'", async () => {
    const supabase = createMockSupabase(() => ({ data: { status: "active" }, error: null }));
    const status = await getDriveConnectionStatusCompat(supabase as never, "u1");
    expect(status).toBe("active");
  });

  it("devuelve 'revoked' cuando status = 'revoked'", async () => {
    const supabase = createMockSupabase(() => ({ data: { status: "revoked" }, error: null }));
    const status = await getDriveConnectionStatusCompat(supabase as never, "u1");
    expect(status).toBe("revoked");
  });

  it("degrada a 'active' si la columna status todavía no existe (migración no corrida)", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.columns === "status") return { data: null, error: MISSING_COLUMN_ERROR };
      return { data: { connected_at: "2026-01-01" }, error: null };
    }, calls);

    const status = await getDriveConnectionStatusCompat(supabase as never, "u1");

    expect(status).toBe("active");
    expect(calls.map((c) => c.columns)).toEqual(["status", "connected_at"]);
  });

  it("con el cache en false (TTL vigente), no reintenta la columna status", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase((state) => {
      if (state.columns === "status") return { data: null, error: MISSING_COLUMN_ERROR };
      return { data: { connected_at: "2026-01-01" }, error: null };
    }, calls);

    await getDriveConnectionStatusCompat(supabase as never, "u1"); // primera detección: cachea false
    calls.length = 0;
    const status = await getDriveConnectionStatusCompat(supabase as never, "u1"); // usa el cache

    expect(status).toBe("active");
    expect(calls.map((c) => c.columns)).toEqual(["connected_at"]);
  });
});

describe("markDriveConnectionRevoked", () => {
  beforeEach(() => {
    resetDriveConnectionStatusCacheForTests();
  });

  it("actualiza status='revoked' cuando la columna existe", async () => {
    const calls: QueryState[] = [];
    const supabase = createMockSupabase(() => ({ data: null, error: null }), calls);

    await markDriveConnectionRevoked(supabase as never, "u1");

    expect(calls).toHaveLength(1);
    expect(calls[0].mode).toBe("update");
    expect(calls[0].updatePayload).toEqual({ status: "revoked" });
    expect(calls[0].filters).toEqual({ user_id: "u1" });
  });

  it("no lanza si la columna status todavía no existe (no-op silencioso)", async () => {
    const supabase = createMockSupabase(() => ({ data: null, error: MISSING_COLUMN_ERROR }));

    await expect(markDriveConnectionRevoked(supabase as never, "u1")).resolves.toBeUndefined();
  });
});
