import { describe, it, expect } from "vitest";
import { buildChatNoteDraft, deriveChatNoteTitle, CHAT_NOTE_TAG, CHAT_NOTE_AUDIO_NAME, CHAT_NOTE_ICON } from "./chatNote";

describe("deriveChatNoteTitle", () => {
  it("usa la primera línea no vacía como título", () => {
    expect(deriveChatNoteTitle("Primera línea\nresto del contenido")).toBe("Primera línea");
  });

  it("saltea líneas en blanco iniciales", () => {
    expect(deriveChatNoteTitle("\n\n  \nContenido real acá")).toBe("Contenido real acá");
  });

  it("pela un heading Markdown ('# ', '## ', ...)", () => {
    expect(deriveChatNoteTitle("## Resumen de la reunión\nmás texto")).toBe("Resumen de la reunión");
  });

  it("pela énfasis Markdown suelto (*, _, `)", () => {
    expect(deriveChatNoteTitle("**Idea clave**: hacer esto")).toBe("Idea clave: hacer esto");
  });

  it("trunca títulos muy largos con elipsis", () => {
    const long = "palabra ".repeat(30).trim();
    const title = deriveChatNoteTitle(long);
    expect(title.length).toBeLessThanOrEqual(81); // 80 + "…"
    expect(title.endsWith("…")).toBe(true);
  });

  it("fallback a 'Nota del chat' si el texto queda vacío tras limpiar", () => {
    expect(deriveChatNoteTitle("")).toBe("Nota del chat");
    expect(deriveChatNoteTitle("   \n  \n ")).toBe("Nota del chat");
    expect(deriveChatNoteTitle("###")).toBe("Nota del chat");
  });
});

describe("buildChatNoteDraft", () => {
  it("arma el draft con título derivado, texto trimeado y el tag distintivo", () => {
    const draft = buildChatNoteDraft("  ## Plan de acción\n1. Hacer X\n2. Hacer Y  ");
    expect(draft).toEqual({
      title: "Plan de acción",
      text: "## Plan de acción\n1. Hacer X\n2. Hacer Y",
      audio_name: CHAT_NOTE_AUDIO_NAME,
      icon: CHAT_NOTE_ICON,
      tags: [CHAT_NOTE_TAG],
    });
  });

  it("devuelve un error si el texto está vacío o son solo espacios", () => {
    expect(buildChatNoteDraft("")).toEqual({ error: "No hay contenido para guardar." });
    expect(buildChatNoteDraft("   ")).toEqual({ error: "No hay contenido para guardar." });
  });

  it("nunca lanza con undefined/null", () => {
    expect(() => buildChatNoteDraft(undefined as unknown as string)).not.toThrow();
    expect(() => buildChatNoteDraft(null as unknown as string)).not.toThrow();
  });
});
