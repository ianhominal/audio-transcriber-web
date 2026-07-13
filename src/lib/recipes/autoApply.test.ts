import { describe, it, expect, beforeEach, vi } from "vitest";

// `applyRecipeText` hace la llamada real al modelo (ver apply.test.ts) — se mockea acá para poder
// testear la orquestación de ownership/cap/lookup de `autoApplyDefaultRecipe` de forma aislada, mismo
// criterio de capas que el resto de la app (cada módulo testea SU responsabilidad).
vi.mock("./apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apply")>();
  return { ...actual, applyRecipeText: vi.fn() };
});

import { applyRecipeText } from "./apply";
import { autoApplyDefaultRecipe } from "./autoApply";

type MaybeSingleResult<T> = { data: T | null; error: { message: string; code?: string } | null };
type InsertResult = { error: { message: string; code?: string } | null };

function createAiRecipesTable(result: MaybeSingleResult<{ id: string; name: string; instruction: string }>) {
  const calls: { eqCalls: [string, unknown][] } = { eqCalls: [] };
  const table = {
    select() {
      return table;
    },
    eq(column: string, value: unknown) {
      calls.eqCalls.push([column, value]);
      return table;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  return { table, calls };
}

function createMockSupabase(options: {
  recipe?: MaybeSingleResult<{ id: string; name: string; instruction: string }>;
  usageLogInsert?: InsertResult;
}) {
  const recipeResult = options.recipe ?? { data: null, error: null };
  const usageLogResult = options.usageLogInsert ?? { error: null };
  const usageLogInsertCalls: unknown[] = [];
  const { table: aiRecipesTable, calls: aiRecipesCalls } = createAiRecipesTable(recipeResult);

  const supabase = {
    from(table: string) {
      if (table === "ai_recipes") return aiRecipesTable;
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
  };

  return { supabase, usageLogInsertCalls, aiRecipesCalls };
}

const defaultRecipe = { id: "r1", name: "Brief de producción", instruction: "Convertí esto en un brief." };

beforeEach(() => {
  vi.mocked(applyRecipeText).mockReset();
});

describe("autoApplyDefaultRecipe — sin formato default (nada que hacer)", () => {
  it("devuelve null y no llama al modelo cuando el usuario no tiene ningún formato marcado default", async () => {
    const { supabase, usageLogInsertCalls } = createMockSupabase({ recipe: { data: null, error: null } });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto de la transcripción.");

    expect(result).toBeNull();
    expect(applyRecipeText).not.toHaveBeenCalled();
    expect(usageLogInsertCalls).toHaveLength(0);
  });

  it("devuelve null (degradado) cuando ai_recipes todavía no está migrada (42P01)", async () => {
    const { supabase, usageLogInsertCalls } = createMockSupabase({
      recipe: { data: null, error: { message: 'relation "ai_recipes" does not exist', code: "42P01" } },
    });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(result).toBeNull();
    expect(applyRecipeText).not.toHaveBeenCalled();
    expect(usageLogInsertCalls).toHaveLength(0);
  });

  it("devuelve null ante un error inesperado de la query de ai_recipes (fail-safe, nunca lanza)", async () => {
    const { supabase } = createMockSupabase({ recipe: { data: null, error: { message: "connection reset" } } });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(result).toBeNull();
    expect(applyRecipeText).not.toHaveBeenCalled();
  });
});

describe("autoApplyDefaultRecipe — ownership", () => {
  it("scopea la consulta de ai_recipes por user_id ADEMÁS de is_default (defensa en profundidad, no solo RLS)", async () => {
    const { supabase, aiRecipesCalls } = createMockSupabase({ recipe: { data: null, error: null } });

    await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(aiRecipesCalls.eqCalls).toContainEqual(["user_id", "u1"]);
    expect(aiRecipesCalls.eqCalls).toContainEqual(["is_default", true]);
  });
});

describe("autoApplyDefaultRecipe — cap de uso diario (reusa ai_usage_log, kind: 'recipe')", () => {
  it("devuelve null y NO llama al modelo cuando el trigger rechaza por límite diario", async () => {
    const { supabase } = createMockSupabase({
      recipe: { data: defaultRecipe, error: null },
      usageLogInsert: { error: { message: "ai_recipe_daily_limit_reached" } },
    });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(result).toBeNull();
    expect(applyRecipeText).not.toHaveBeenCalled();
  });

  it("degrada sin cap (sigue llamando al modelo) cuando ai_usage_log todavía no existe (42P01)", async () => {
    vi.mocked(applyRecipeText).mockResolvedValue({ ok: true, text: "Resultado generado." });
    const { supabase } = createMockSupabase({
      recipe: { data: defaultRecipe, error: null },
      usageLogInsert: { error: { message: 'relation "ai_usage_log" does not exist', code: "42P01" } },
    });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(applyRecipeText).toHaveBeenCalled();
    expect(result).toEqual({ output: "Resultado generado.", recipeName: "Brief de producción" });
  });

  it("devuelve null (fail-safe) ante un error real al reservar cuota, sin llamar al modelo", async () => {
    const { supabase } = createMockSupabase({
      recipe: { data: defaultRecipe, error: null },
      usageLogInsert: { error: { message: "connection reset" } },
    });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(result).toBeNull();
    expect(applyRecipeText).not.toHaveBeenCalled();
  });
});

describe("autoApplyDefaultRecipe — generación exitosa", () => {
  it("devuelve { output, recipeName } cuando hay formato default, cap ok, y el modelo responde", async () => {
    vi.mocked(applyRecipeText).mockResolvedValue({ ok: true, text: "Brief generado con éxito." });
    const { supabase } = createMockSupabase({ recipe: { data: defaultRecipe, error: null } });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto completo de la nota.");

    expect(applyRecipeText).toHaveBeenCalledWith(
      defaultRecipe.instruction,
      "Texto completo de la nota.",
      expect.any(Number)
    );
    expect(result).toEqual({ output: "Brief generado con éxito.", recipeName: "Brief de producción" });
  });
});

describe("autoApplyDefaultRecipe — falla/timeout del modelo (nunca rompe el caller)", () => {
  it("devuelve null (best-effort) cuando applyRecipeText devuelve ok:false", async () => {
    vi.mocked(applyRecipeText).mockResolvedValue({ ok: false, error: "timeout" });
    const { supabase } = createMockSupabase({ recipe: { data: defaultRecipe, error: null } });

    const result = await autoApplyDefaultRecipe(supabase as never, "u1", "Texto.");

    expect(result).toBeNull();
  });
});
