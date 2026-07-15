import { describe, expect, it } from "vitest";
import {
  buildWrittenNoteDraft,
  deriveWrittenNoteTitle,
  MAX_WRITTEN_NOTE_TEXT_CHARS,
  WRITTEN_NOTE_AUDIO_NAME,
  WRITTEN_NOTE_ICON,
} from "./writtenNote";

describe("deriveWrittenNoteTitle", () => {
  it("uses the first line with content", () => {
    expect(deriveWrittenNoteTitle("\n\n  Idea para el jingle\nsegunda línea")).toBe("Idea para el jingle");
  });

  it("falls back when there is nothing usable", () => {
    expect(deriveWrittenNoteTitle("   \n  \n ")).toBe("Nota");
    expect(deriveWrittenNoteTitle("")).toBe("Nota");
  });

  it("truncates a very long first line with an ellipsis", () => {
    const result = deriveWrittenNoteTitle("a".repeat(200));
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(121);
  });
});

describe("buildWrittenNoteDraft", () => {
  it("rejects empty text", () => {
    expect(buildWrittenNoteDraft("")).toEqual({ error: "Escribí algo antes de guardar la nota." });
    expect(buildWrittenNoteDraft("   \n ")).toHaveProperty("error");
  });

  it("keeps the title the user typed", () => {
    const draft = buildWrittenNoteDraft("cuerpo de la nota", "  Mi título  ");
    expect(draft).toMatchObject({ title: "Mi título", text: "cuerpo de la nota" });
  });

  it("derives the title from the text when none is typed", () => {
    expect(buildWrittenNoteDraft("Primera línea\nresto")).toMatchObject({ title: "Primera línea" });
    expect(buildWrittenNoteDraft("Primera línea", "   ")).toMatchObject({ title: "Primera línea" });
  });

  it("caps a typed title at 120 chars", () => {
    const draft = buildWrittenNoteDraft("cuerpo", "t".repeat(300));
    expect("title" in draft && draft.title.length).toBe(120);
  });

  it("marks the note as text-only with the fixed audio label and icon", () => {
    expect(buildWrittenNoteDraft("hola")).toMatchObject({
      audio_name: WRITTEN_NOTE_AUDIO_NAME,
      icon: WRITTEN_NOTE_ICON,
    });
  });

  it("adds no automatic tags (unlike chat notes)", () => {
    expect(buildWrittenNoteDraft("hola")).toMatchObject({ tags: [] });
  });

  it("truncates instead of rejecting very long text", () => {
    const draft = buildWrittenNoteDraft("x".repeat(MAX_WRITTEN_NOTE_TEXT_CHARS + 500));
    expect("text" in draft && draft.text.length).toBe(MAX_WRITTEN_NOTE_TEXT_CHARS);
  });

  it("tolerates a null title", () => {
    expect(buildWrittenNoteDraft("hola", null)).toMatchObject({ title: "hola" });
  });
});
