import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  clampLimit,
  buildExcerpt,
  listTranscriptions,
  getTranscription,
  searchTranscriptions,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  TRANSCRIPTION_ID_SCHEMA,
} from "./tools";

// ---------- Fake Supabase client: REALISTICALLY filters seeded rows, not just a call-recorder ----------
// This matters: the whole point of the IDOR tests below is to prove that tools.ts's OWN query
// construction (the `.eq("user_id", userId)` calls) is what keeps another user's rows out of the
// result. A fake that merely records "was .eq('user_id', ...) called" without actually filtering
// the data would let a real ownership bug slip through completely undetected — it would assert
// the right method was called while still handing back leaked rows. This fake behaves like a
// service-role client hitting real tables with no RLS: whatever `tools.ts` fails to filter, leaks.
type Row = Record<string, unknown>;

function createFakeQuery(seedRows: Row[]) {
  let rows = seedRows;
  const builder = {
    eq(col: string, val: unknown) {
      rows = rows.filter((r) => r[col] === val);
      return builder;
    },
    is(col: string, val: unknown) {
      rows = rows.filter((r) => r[col] === val);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false;
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
      return builder;
    },
    limit(n: number) {
      rows = rows.slice(0, n);
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function createFakeSupabase(tables: { transcriptions?: Row[]; projects?: Row[] }) {
  return {
    from(table: string) {
      if (table === "transcriptions") return { select: () => createFakeQuery(tables.transcriptions ?? []) };
      if (table === "projects") return { select: () => createFakeQuery(tables.projects ?? []) };
      throw new Error(`Unexpected table in test: ${table}`);
    },
  } as never;
}

const AUDIO_URL_SENTINEL = "SHOULD_NEVER_LEAK_AUDIO_URL";

function makeTranscriptionRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "t1",
    user_id: "user-A",
    project_id: null,
    title: "My transcription",
    description: "",
    text: "This is the full transcribed text content.",
    language: "en",
    audio_url: AUDIO_URL_SENTINEL,
    translated_to: null,
    original_text: null,
    summary: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function contentText(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("Expected a text content block");
  return block.text;
}

function parseJson(result: CallToolResult): unknown {
  return JSON.parse(contentText(result));
}

describe("clampLimit", () => {
  it("returns the default when no limit is requested", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
  });

  it("returns the requested value when within range", () => {
    expect(clampLimit(5)).toBe(5);
  });

  it("clamps to MAX_LIST_LIMIT when the request is too high", () => {
    expect(clampLimit(9999)).toBe(MAX_LIST_LIMIT);
  });

  it("clamps up to 1 for zero or negative input", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it("floors non-integer input", () => {
    expect(clampLimit(3.9)).toBe(3);
  });
});

describe("buildExcerpt", () => {
  const longText =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. The important keyword appears right here in the middle. " +
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

  it("returns a window centered on the match, with ellipses on both truncated sides", () => {
    const excerpt = buildExcerpt(longText, "important keyword", 60);
    expect(excerpt.toLowerCase()).toContain("important keyword");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("does not prefix with an ellipsis when the match is near the start", () => {
    const excerpt = buildExcerpt(longText, "Lorem ipsum", 60);
    expect(excerpt.startsWith("…")).toBe(false);
  });

  it("falls back to a leading truncation when the query isn't found in the text", () => {
    const excerpt = buildExcerpt(longText, "not present anywhere", 20);
    expect(excerpt.startsWith("…")).toBe(false);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(21);
  });

  it("returns the text unchanged when it already fits", () => {
    expect(buildExcerpt("short text", "text", 160)).toBe("short text");
  });

  it("handles empty text", () => {
    expect(buildExcerpt("", "anything", 160)).toBe("");
  });
});

describe("listTranscriptions", () => {
  it("guards against a falsy userId — never touches Supabase", async () => {
    const result = await listTranscriptions(createFakeSupabase({}), "", {});
    expect(result.isError).toBe(true);
  });

  it("returns only the caller's own transcriptions, even when the table has mixed owners", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", user_id: "user-A", title: "A one" }),
        makeTranscriptionRow({ id: "b1", user_id: "user-B", title: "B one" }),
        makeTranscriptionRow({ id: "b2", user_id: "user-B", title: "B two" }),
      ],
      projects: [],
    });

    const result = await listTranscriptions(supabase, "user-A", {});
    const items = parseJson(result) as Array<{ id: string }>;

    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("never includes audio_url anywhere in the serialized output", async () => {
    const supabase = createFakeSupabase({ transcriptions: [makeTranscriptionRow({ id: "a1" })], projects: [] });
    const result = await listTranscriptions(supabase, "user-A", {});
    expect(contentText(result)).not.toContain(AUDIO_URL_SENTINEL);
  });

  it("never includes the full text field — only metadata", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "a1", text: "UNIQUE_FULL_TEXT_MARKER" })],
      projects: [],
    });
    const result = await listTranscriptions(supabase, "user-A", {});
    expect(contentText(result)).not.toContain("UNIQUE_FULL_TEXT_MARKER");
  });

  it("excludes soft-deleted transcriptions", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", deleted_at: null }),
        makeTranscriptionRow({ id: "a2", deleted_at: "2026-07-05T00:00:00.000Z" }),
      ],
      projects: [],
    });
    const result = await listTranscriptions(supabase, "user-A", {});
    const items = parseJson(result) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("resolves project names via the caller's own projects only", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "a1", project_id: "p1" })],
      projects: [{ id: "p1", user_id: "user-A", name: "Podcast" }],
    });
    const result = await listTranscriptions(supabase, "user-A", {});
    const items = parseJson(result) as Array<{ project: string | null }>;
    expect(items[0].project).toBe("Podcast");
  });

  it("never resolves a project name belonging to a different user, even if the id happens to match", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "a1", user_id: "user-A", project_id: "p1" })],
      projects: [{ id: "p1", user_id: "user-B", name: "user-B's private project name" }],
    });
    const result = await listTranscriptions(supabase, "user-A", {});
    expect(contentText(result)).not.toContain("user-B's private project name");
  });

  it("derives translated/summarized booleans from translated_to/summary", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", translated_to: "en", summary: null }),
        makeTranscriptionRow({ id: "a2", translated_to: null, summary: '{"summary":"x"}' }),
      ],
      projects: [],
    });
    const result = await listTranscriptions(supabase, "user-A", {});
    const items = parseJson(result) as Array<{ id: string; translated: boolean; summarized: boolean }>;
    const a1 = items.find((i) => i.id === "a1")!;
    const a2 = items.find((i) => i.id === "a2")!;
    expect(a1.translated).toBe(true);
    expect(a1.summarized).toBe(false);
    expect(a2.translated).toBe(false);
    expect(a2.summarized).toBe(true);
  });

  it("filters by search (case-insensitive title match)", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", title: "Interview with Jane" }),
        makeTranscriptionRow({ id: "a2", title: "Weekly standup" }),
      ],
      projects: [],
    });
    const result = await listTranscriptions(supabase, "user-A", { search: "interview" });
    const items = parseJson(result) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("filters by projectId", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", project_id: "p1" }),
        makeTranscriptionRow({ id: "a2", project_id: "p2" }),
      ],
      projects: [{ id: "p1", user_id: "user-A", name: "Podcast" }],
    });
    const result = await listTranscriptions(supabase, "user-A", { projectId: "p1" });
    const items = parseJson(result) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("clamps an excessive limit to MAX_LIST_LIMIT", async () => {
    const rows = Array.from({ length: MAX_LIST_LIMIT + 20 }, (_, i) =>
      makeTranscriptionRow({ id: `a${i}`, created_at: `2026-07-01T00:00:${String(i % 60).padStart(2, "0")}.000Z` })
    );
    const supabase = createFakeSupabase({ transcriptions: rows, projects: [] });
    const result = await listTranscriptions(supabase, "user-A", { limit: 9999 });
    const items = parseJson(result) as Array<{ id: string }>;
    expect(items.length).toBe(MAX_LIST_LIMIT);
  });
});

describe("TRANSCRIPTION_ID_SCHEMA", () => {
  it("accepts a well-formed UUID", () => {
    expect(TRANSCRIPTION_ID_SCHEMA.safeParse("123e4567-e89b-12d3-a456-426614174000").success).toBe(true);
  });

  it("rejects a malformed id instead of letting it reach the database", () => {
    expect(TRANSCRIPTION_ID_SCHEMA.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(TRANSCRIPTION_ID_SCHEMA.safeParse("").success).toBe(false);
  });

  it("rejects a missing value", () => {
    expect(TRANSCRIPTION_ID_SCHEMA.safeParse(undefined).success).toBe(false);
  });
});

describe("getTranscription — the critical IDOR checkpoint", () => {
  it("guards against a falsy userId — never touches Supabase", async () => {
    const result = await getTranscription(createFakeSupabase({}), "", { id: "t1" });
    expect(result.isError).toBe(true);
  });

  it("THE mandatory test: a transcription belonging to another user is a clean not-found, never the data", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "victim-1", user_id: "user-B", text: "user-B's private content" })],
      projects: [],
    });

    const result = await getTranscription(supabase, "user-A", { id: "victim-1" });

    expect(result.isError).toBe(true);
    expect(contentText(result)).not.toContain("user-B's private content");
    expect(contentText(result).toLowerCase()).toContain("not found");
  });

  it("is indistinguishable from a genuinely nonexistent id (same shape either way)", async () => {
    const supabase = createFakeSupabase({ transcriptions: [], projects: [] });
    const result = await getTranscription(supabase, "user-A", { id: "does-not-exist" });
    expect(result.isError).toBe(true);
    expect(contentText(result).toLowerCase()).toContain("not found");
  });

  it("returns the full detail for the caller's own transcription", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({
          id: "t1",
          user_id: "user-A",
          title: "Mine",
          text: "my own private content",
          project_id: "p1",
        }),
      ],
      projects: [{ id: "p1", user_id: "user-A", name: "Podcast" }],
    });

    const result = await getTranscription(supabase, "user-A", { id: "t1" });

    expect(result.isError).toBeFalsy();
    const detail = parseJson(result) as { id: string; text: string; project: string | null };
    expect(detail.id).toBe("t1");
    expect(detail.text).toBe("my own private content");
    expect(detail.project).toBe("Podcast");
  });

  it("never resolves a project name belonging to a different user, even if the id happens to match", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "t1", user_id: "user-A", project_id: "p1" })],
      projects: [{ id: "p1", user_id: "user-B", name: "user-B's private project name" }],
    });
    const result = await getTranscription(supabase, "user-A", { id: "t1" });
    expect(contentText(result)).not.toContain("user-B's private project name");
  });

  it("never includes audio_url in the output, even for the caller's own transcription", async () => {
    const supabase = createFakeSupabase({ transcriptions: [makeTranscriptionRow({ id: "t1", user_id: "user-A" })], projects: [] });
    const result = await getTranscription(supabase, "user-A", { id: "t1" });
    expect(contentText(result)).not.toContain(AUDIO_URL_SENTINEL);
  });

  it("treats a soft-deleted transcription as not found, even for its own owner", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "t1", user_id: "user-A", deleted_at: "2026-07-05T00:00:00.000Z" })],
      projects: [],
    });
    const result = await getTranscription(supabase, "user-A", { id: "t1" });
    expect(result.isError).toBe(true);
  });
});

describe("searchTranscriptions", () => {
  it("guards against a falsy userId — never touches Supabase", async () => {
    const result = await searchTranscriptions(createFakeSupabase({}), "", { query: "test" });
    expect(result.isError).toBe(true);
  });

  it("never returns another user's rows, even when the table has mixed owners with matching text", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", user_id: "user-A", text: "talks about kubernetes" }),
        makeTranscriptionRow({ id: "b1", user_id: "user-B", text: "also talks about kubernetes" }),
      ],
      projects: [],
    });

    const result = await searchTranscriptions(supabase, "user-A", { query: "kubernetes" });
    const items = parseJson(result) as Array<{ id: string }>;

    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("matches against title, text, and description (case-insensitive)", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", title: "Kubernetes deep dive", text: "irrelevant", description: "" }),
        makeTranscriptionRow({ id: "a2", title: "Unrelated", text: "we discuss KUBERNETES here", description: "" }),
        makeTranscriptionRow({ id: "a3", title: "Unrelated", text: "irrelevant", description: "kubernetes notes" }),
        makeTranscriptionRow({ id: "a4", title: "Unrelated", text: "irrelevant", description: "" }),
      ],
      projects: [],
    });

    const result = await searchTranscriptions(supabase, "user-A", { query: "kubernetes" });
    const items = parseJson(result) as Array<{ id: string }>;

    expect(items.map((i) => i.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("returns an excerpt shape, not the full text", async () => {
    const longText = `${"x".repeat(5000)} kubernetes ${"y".repeat(5000)}`;
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "a1", text: longText })],
      projects: [],
    });
    const result = await searchTranscriptions(supabase, "user-A", { query: "kubernetes" });
    const items = parseJson(result) as Array<{ excerpt: string }>;
    expect(items[0].excerpt.length).toBeLessThan(longText.length);
    expect(items[0].excerpt.toLowerCase()).toContain("kubernetes");
  });

  it("never includes audio_url in the serialized output", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [makeTranscriptionRow({ id: "a1", text: "kubernetes talk" })],
      projects: [],
    });
    const result = await searchTranscriptions(supabase, "user-A", { query: "kubernetes" });
    expect(contentText(result)).not.toContain(AUDIO_URL_SENTINEL);
  });

  it("excludes soft-deleted transcriptions", async () => {
    const supabase = createFakeSupabase({
      transcriptions: [
        makeTranscriptionRow({ id: "a1", text: "kubernetes", deleted_at: null }),
        makeTranscriptionRow({ id: "a2", text: "kubernetes", deleted_at: "2026-07-05T00:00:00.000Z" }),
      ],
      projects: [],
    });
    const result = await searchTranscriptions(supabase, "user-A", { query: "kubernetes" });
    const items = parseJson(result) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(["a1"]);
  });
});
