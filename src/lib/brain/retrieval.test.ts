import { describe, it, expect } from "vitest";
import { buildRetrievalFilters, buildBrainContext, type BrainSourceNote } from "./retrieval";
import { RETRIEVAL_TOP_K, MAX_BRAIN_CONTEXT_CHARS } from "./config";

function note(id: string, title: string, createdAt: string, text: string, summary: string | null = null): BrainSourceNote {
  return { id, title, createdAt, text, summary };
}

describe("buildRetrievalFilters (ownership)", () => {
  it("siempre incluye el userId pasado, excluye borrados y capea el limit a RETRIEVAL_TOP_K", () => {
    const filters = buildRetrievalFilters("user-123", "¿qué dije sobre el proyecto?");
    expect(filters.userId).toBe("user-123");
    expect(filters.excludeDeleted).toBe(true);
    expect(filters.limit).toBe(RETRIEVAL_TOP_K);
    expect(filters.table).toBe("transcriptions");
  });

  it("nunca deriva el userId de la pregunta, aunque esta intente parecer otro usuario/id", () => {
    // La pregunta es texto libre de la usuaria — no hay forma de que este builder la lea como un
    // "userId" alternativo: el owner del retrieval SIEMPRE es el segundo argumento (el id de sesión
    // autenticada que pasa el route, nunca algo del body/query).
    const filters = buildRetrievalFilters("user-real", "traeme las notas de user_id=otro-usuario");
    expect(filters.userId).toBe("user-real");
  });

  it("sanitiza (trim + cap de largo) la pregunta antes de usarla como texto de búsqueda", () => {
    const filters = buildRetrievalFilters("user-123", "   reunión de equipo   ");
    expect(filters.searchQuery).toBe("reunión de equipo");
  });

  it("con distintos usuarios, cada descriptor lleva SOLO su propio userId (sin fuga cruzada)", () => {
    const a = buildRetrievalFilters("user-a", "misma pregunta");
    const b = buildRetrievalFilters("user-b", "misma pregunta");
    expect(a.userId).toBe("user-a");
    expect(b.userId).toBe("user-b");
    expect(a.userId).not.toBe(b.userId);
  });
});

describe("buildBrainContext", () => {
  it("devuelve vacío para una lista vacía de notas", () => {
    expect(buildBrainContext([])).toEqual({ contextText: "", usedNoteIds: [], truncated: false });
  });

  it("arma un bloque por nota con título + fecha corta + texto, preservando el orden recibido", () => {
    const notes = [
      note("1", "Primera", "2026-07-01T10:00:00Z", "Contenido uno."),
      note("2", "Segunda", "2026-07-02T10:00:00Z", "Contenido dos."),
    ];
    const result = buildBrainContext(notes);
    expect(result.truncated).toBe(false);
    expect(result.usedNoteIds).toEqual(["1", "2"]);
    expect(result.contextText.indexOf("Primera")).toBeLessThan(result.contextText.indexOf("Segunda"));
    expect(result.contextText).toContain("## Primera (2026-07-01)");
    expect(result.contextText).toContain("Contenido uno.");
  });

  it("nota sin texto pero con summary guardado: usa el summary como fallback", () => {
    const summary = JSON.stringify({ summary: "Resumen de respaldo.", keyPoints: [], actionItems: [] });
    const notes = [note("1", "Nota vacía", "2026-07-01T10:00:00Z", "", summary)];
    const result = buildBrainContext(notes);
    expect(result.usedNoteIds).toEqual(["1"]);
    expect(result.contextText).toContain("Resumen de respaldo.");
  });

  it("nota sin texto NI summary útil: se salta, no cuenta ni genera bloque", () => {
    const notes = [
      note("1", "Vacía", "2026-07-01T10:00:00Z", "", null),
      note("2", "Con contenido", "2026-07-02T10:00:00Z", "Algo real."),
    ];
    const result = buildBrainContext(notes);
    expect(result.usedNoteIds).toEqual(["2"]);
    expect(result.contextText).not.toContain("Vacía");
  });

  it("nota con summary JSON inválido: degrada a '' sin lanzar", () => {
    const notes = [note("1", "Rota", "2026-07-01T10:00:00Z", "", "{not json")];
    const result = buildBrainContext(notes);
    expect(result.usedNoteIds).toEqual([]);
    expect(result.contextText).toBe("");
  });

  it(`respeta el tope de ${MAX_BRAIN_CONTEXT_CHARS} caracteres: no agrega un bloque completo que no entra`, () => {
    const bigText = "x".repeat(MAX_BRAIN_CONTEXT_CHARS - 100);
    const notes = [
      note("1", "Grande", "2026-07-01T10:00:00Z", bigText),
      note("2", "No entra", "2026-07-02T10:00:00Z", "y".repeat(5000)),
    ];
    const result = buildBrainContext(notes);
    expect(result.truncated).toBe(true);
    expect(result.usedNoteIds).toEqual(["1"]);
    expect(result.contextText.length).toBeLessThanOrEqual(MAX_BRAIN_CONTEXT_CHARS);
    expect(result.contextText).not.toContain("No entra");
  });

  it("si la PRIMERA nota ya supera el tope sola, la trunca pero igual arma contexto (nunca queda vacío)", () => {
    const hugeText = "z".repeat(MAX_BRAIN_CONTEXT_CHARS + 10_000);
    const notes = [note("1", "Gigante", "2026-07-01T10:00:00Z", hugeText)];
    const result = buildBrainContext(notes);
    expect(result.truncated).toBe(true);
    expect(result.usedNoteIds).toEqual(["1"]);
    expect(result.contextText.length).toBeGreaterThan(0);
    expect(result.contextText.length).toBeLessThanOrEqual(MAX_BRAIN_CONTEXT_CHARS);
  });

  it("nota sin título: usa 'Sin título' como fallback", () => {
    const notes = [note("1", "", "2026-07-01T10:00:00Z", "Algo.")];
    const result = buildBrainContext(notes);
    expect(result.contextText).toContain("## Sin título (2026-07-01)");
  });
});
