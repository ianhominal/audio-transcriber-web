import { describe, it, expect } from "vitest";
import {
  formatFileSize,
  formatDuration,
  formatDate,
  validateProjectName,
  formatRecordingFileName,
  defaultTitleFromFileName,
  normalizeQueueTitle,
  resolveQueueTitle,
  buildMarkdownExport,
  parseMarkdownExport,
  slugifyFileName,
} from "./format";

describe("formatFileSize", () => {
  it("muestra bytes cuando es menor a 1 KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("convierte a KB y MB con hasta 1 decimal", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1048576)).toBe("1 MB");
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });

  it("tolera valores inválidos", () => {
    expect(formatFileSize(-10)).toBe("0 B");
    expect(formatFileSize(NaN)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("formatea segundos como m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("tolera valores inválidos", () => {
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
  });
});

describe("formatDate", () => {
  it("devuelve una fecha legible para un ISO válido", () => {
    // 2026-07-06T15:40:44Z → contiene el año
    expect(formatDate("2026-07-06T15:40:44Z")).toContain("2026");
  });

  it("devuelve cadena vacía si el ISO es inválido", () => {
    expect(formatDate("no-es-fecha")).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("formatRecordingFileName", () => {
  it("arma <prefijo>-<timestamp>.<extensión>", () => {
    expect(formatRecordingFileName("Grabacion", 1720368000000, "webm")).toBe(
      "Grabacion-1720368000000.webm"
    );
  });

  it("acepta la extensión con o sin punto inicial", () => {
    expect(formatRecordingFileName("Reunion", 123, ".webm")).toBe("Reunion-123.webm");
    expect(formatRecordingFileName("Reunion", 123, "webm")).toBe("Reunion-123.webm");
  });
});

describe("defaultTitleFromFileName", () => {
  it("le saca la extensión al nombre de archivo", () => {
    expect(defaultTitleFromFileName("Grabacion-1720368000000.webm")).toBe("Grabacion-1720368000000");
    expect(defaultTitleFromFileName("Reunion-123.ogg")).toBe("Reunion-123");
  });

  it("tolera nombres sin extensión", () => {
    expect(defaultTitleFromFileName("SinExtension")).toBe("SinExtension");
  });

  it("tolera valores vacíos o inválidos", () => {
    expect(defaultTitleFromFileName("")).toBe("");
    // @ts-expect-error valor inválido a propósito, para probar la tolerancia en runtime
    expect(defaultTitleFromFileName(undefined)).toBe("");
  });
});

describe("normalizeQueueTitle", () => {
  it("recorta espacios al inicio y al final", () => {
    expect(normalizeQueueTitle("  Reunión de equipo  ", "Grabacion-1")).toBe("Reunión de equipo");
  });

  it("vuelve al fallback si el título editado queda vacío", () => {
    expect(normalizeQueueTitle("", "Grabacion-1720368000000")).toBe("Grabacion-1720368000000");
    expect(normalizeQueueTitle("   ", "audio.mp3")).toBe("audio.mp3");
  });

  it("tolera valores inválidos como si estuvieran vacíos", () => {
    // @ts-expect-error valor inválido a propósito, para probar la tolerancia en runtime
    expect(normalizeQueueTitle(undefined, "fallback")).toBe("fallback");
  });
});

describe("resolveQueueTitle", () => {
  it("prefiere el título de la respuesta del server sobre el fallback", () => {
    expect(resolveQueueTitle("Reunión de equipo sobre el lanzamiento", "Grabacion-1720368000000")).toBe(
      "Reunión de equipo sobre el lanzamiento"
    );
  });

  it("recorta espacios del título de la respuesta", () => {
    expect(resolveQueueTitle("  Título con espacios  ", "audio.mp3")).toBe("Título con espacios");
  });

  it("cae al fallback si el título de la respuesta viene vacío o solo espacios", () => {
    expect(resolveQueueTitle("", "Grabacion-1720368000000")).toBe("Grabacion-1720368000000");
    expect(resolveQueueTitle("   ", "audio.mp3")).toBe("audio.mp3");
  });

  it("cae al fallback si el título de la respuesta es null o undefined (auto-título best-effort falló)", () => {
    expect(resolveQueueTitle(null, "Grabacion-1720368000000")).toBe("Grabacion-1720368000000");
    expect(resolveQueueTitle(undefined, "audio.mp3")).toBe("audio.mp3");
  });
});

describe("buildMarkdownExport", () => {
  it("arma el frontmatter con title y date, sin project si no hay", () => {
    const md = buildMarkdownExport({
      title: "Reunión de equipo",
      createdAt: "2026-07-06T15:40:44Z",
      projectName: null,
      text: "Hola mundo.",
    });
    expect(md).toBe(
      ['---', 'title: "Reunión de equipo"', 'date: "2026-07-06T15:40:44Z"', "---", "", "Hola mundo."].join("\n")
    );
  });

  it("incluye project cuando está presente", () => {
    const md = buildMarkdownExport({
      title: "Nota",
      createdAt: "2026-07-06T15:40:44Z",
      projectName: "Trabajo",
      text: "Texto.",
    });
    expect(md).toContain('project: "Trabajo"');
  });

  it("escapa comillas dobles en el título", () => {
    const md = buildMarkdownExport({
      title: 'Reunión "importante"',
      createdAt: "2026-07-06T15:40:44Z",
      text: "x",
    });
    expect(md).toContain('title: "Reunión \\"importante\\""');
  });

  it("usa 'Sin título' si el título viene vacío", () => {
    const md = buildMarkdownExport({ title: "   ", createdAt: "2026-07-06T15:40:44Z", text: "x" });
    expect(md).toContain('title: "Sin título"');
  });
});

describe("parseMarkdownExport", () => {
  it("hace round-trip exacto con buildMarkdownExport (con project)", () => {
    const md = buildMarkdownExport({
      title: "Reunión de equipo",
      createdAt: "2026-07-06T15:40:44Z",
      projectName: "Trabajo",
      text: "Línea 1.\nLínea 2.",
    });
    expect(parseMarkdownExport(md)).toEqual({ title: "Reunión de equipo", text: "Línea 1.\nLínea 2." });
  });

  it("hace round-trip exacto sin project", () => {
    const md = buildMarkdownExport({ title: "Nota", createdAt: "2026-07-06T15:40:44Z", text: "Hola." });
    expect(parseMarkdownExport(md)).toEqual({ title: "Nota", text: "Hola." });
  });

  it("desescapa comillas dobles y backslashes en el título", () => {
    const md = buildMarkdownExport({
      title: 'Reunión "importante"',
      createdAt: "2026-07-06T15:40:44Z",
      text: "x",
    });
    expect(parseMarkdownExport(md).title).toBe('Reunión "importante"');
  });

  it("devuelve title null y el contenido completo si no hay frontmatter", () => {
    expect(parseMarkdownExport("Solo texto plano, sin frontmatter.")).toEqual({
      title: null,
      text: "Solo texto plano, sin frontmatter.",
    });
  });

  it("devuelve el contenido completo si el frontmatter no cierra", () => {
    const broken = '---\ntitle: "Sin cierre"\nEsto sigue sin un segundo ---';
    expect(parseMarkdownExport(broken)).toEqual({ title: null, text: broken });
  });

  it("tolera contenido vacío", () => {
    expect(parseMarkdownExport("")).toEqual({ title: null, text: "" });
  });
});

describe("slugifyFileName", () => {
  it("reemplaza caracteres inválidos de nombre de archivo", () => {
    expect(slugifyFileName('Reunión: "importante" / 2026')).toBe("Reunión- -importante- - 2026");
  });

  it("recorta espacios repetidos y en los extremos", () => {
    expect(slugifyFileName("  Notas   varias  ")).toBe("Notas varias");
  });

  it("usa el fallback si queda vacío", () => {
    expect(slugifyFileName("")).toBe("transcripcion");
    expect(slugifyFileName("   ")).toBe("transcripcion");
    expect(slugifyFileName("///", "audio")).toBe("audio");
  });
});

describe("validateProjectName", () => {
  it("rechaza vacíos o solo espacios", () => {
    expect(validateProjectName("")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
    expect(validateProjectName("   ")).toEqual({ ok: false, error: "El nombre no puede estar vacío." });
  });

  it("recorta espacios y acepta nombres válidos", () => {
    expect(validateProjectName("  Trabajo  ")).toEqual({ ok: true, value: "Trabajo" });
  });

  it("rechaza nombres demasiado largos (>60)", () => {
    const largo = "a".repeat(61);
    expect(validateProjectName(largo)).toEqual({
      ok: false,
      error: "El nombre no puede superar los 60 caracteres.",
    });
  });
});
