import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolvePushOutcome } from "./pushConflict";

/**
 * Team sharing — slice 1a, Task 11.3 (design.md ADR-13). Test de contrato: valida que
 * `resolvePushOutcome` + la forma que arma `/api/sync/push` (`{id, kind, status, version|code}`)
 * producen exactamente el mismo shape que el desktop deserializa (ver
 * `desktop/tests/AudioTranscriber.Core.Tests/SyncDtosTests.cs`,
 * `PushResponseFixture_Deserializa_LosCuatroCasosDelContrato`) sobre el MISMO fixture JSON. Ningún
 * lado hardcodea el otro: si el contrato real de `push/route.ts` driftea de `resolvePushOutcome`,
 * o si el desktop cambia el shape de `PushResultItem`, alguno de los dos tests se rompe.
 */

type FixtureInput = {
  id: string;
  kind: "project" | "transcription";
  existingVersion: number | null;
  baseVersion: number | null;
  isNewRow: boolean;
};

type FixtureResult = {
  id: string;
  kind: "project" | "transcription";
  status: "ok" | "conflict" | "error";
  version?: number;
  code?: string;
};

type FixtureCase = { name: string; input: FixtureInput; result: FixtureResult };
type FixtureFile = { cases: FixtureCase[] };

// The fixture lives INSIDE this repo, next to this test. It used to be read from `openspec/` in the
// containing `Audio-Transcriber/` folder, which is NOT a git repo — so the test only passed on the
// owner's machine and failed on any clean clone.
//
// The desktop counterpart (`tests/AudioTranscriber.Core.Tests/Fixtures/push-response.json`) is a
// deliberate COPY: two separate git repos cannot share a file without submodules. Change the
// contract and both copies must be updated — same rule as the `ai_usage_log` caps, duplicated
// between `aiUsage.ts` and the SQL migrations. Real drift still breaks the test in whichever repo
// was left behind, because each side runs its own logic against the fixture rather than hardcoding
// the other side's answer.
function findFixturePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "push-response.json");
}

/**
 * Reproduce, en lógica pura, lo que hace `push/route.ts` alrededor de `resolvePushOutcome` para
 * armar UN ítem de `results[]` (ver el comentario de cabecera del route: "version resultante...
 * se deriva en memoria en vez de pedirle un round-trip extra a Supabase"). No importa el route
 * completo (necesitaría Supabase real) a propósito -- esto es lo que el diseño llama "la forma de
 * push/route.ts", no el endpoint entero.
 */
function buildResultItem(input: FixtureInput): FixtureResult {
  const outcome = resolvePushOutcome(input.existingVersion, input.baseVersion, input.isNewRow);

  if (outcome.status === "ok") {
    const version = input.existingVersion === null ? 1 : input.existingVersion + 1;
    return { id: input.id, kind: input.kind, status: "ok", version };
  }
  if (outcome.status === "conflict") {
    return { id: input.id, kind: input.kind, status: "conflict", version: outcome.version };
  }
  return { id: input.id, kind: input.kind, status: "error", code: outcome.code };
}

describe("contrato compartido de results[] (fixture desktop/web)", () => {
  const fixture: FixtureFile = JSON.parse(readFileSync(findFixturePath(), "utf-8"));

  it("el fixture trae los cuatro casos esperados", () => {
    expect(fixture.cases).toHaveLength(4);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const actual = buildResultItem(testCase.input);
    expect(actual).toEqual(testCase.result);
  });
});
