import { describe, expect, it } from "vitest";
import { resolveRootProjectAction } from "./connect-root";

/**
 * Real report: connecting a Drive folder answered 200 and imported nothing visible — the project
 * simply never showed up in the list, even after a refresh.
 *
 * Cause: `drive_folders` still held a row pointing at a project the user had deleted in an earlier
 * test. Reconnecting reused that dead id, so the whole import landed inside a project sitting in the
 * bin. Everything "worked", nothing was visible.
 */
describe("resolveRootProjectAction", () => {
  it("creates the project when the folder was never connected", () => {
    expect(resolveRootProjectAction({ mappedProjectId: null, mappedProjectIsAlive: false })).toEqual({
      action: "create",
    });
  });

  it("reuses the project when the mapping points at a live project", () => {
    // The idempotent path: reconnecting the same folder must not duplicate anything.
    expect(resolveRootProjectAction({ mappedProjectId: "p1", mappedProjectIsAlive: true })).toEqual({
      action: "reuse",
      projectId: "p1",
    });
  });

  it("recreates when the mapped project was deleted", () => {
    // The bug. A stale mapping must not swallow the import into an invisible project; the folder
    // gets a fresh project and the mapping is repointed at it.
    expect(resolveRootProjectAction({ mappedProjectId: "p-borrado", mappedProjectIsAlive: false })).toEqual({
      action: "recreate",
      staleProjectId: "p-borrado",
    });
  });
});
