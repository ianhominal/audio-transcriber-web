/** Formatea un tamaño en bytes a una cadena legible (B / KB / MB). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Hasta 1 decimal, sin ".0" innecesario.
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Formatea segundos como m:ss (para el reproductor de audio). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Formatea un ISO a fecha legible (es-AR). Devuelve "" si es inválido. */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Genera un nombre de archivo para audio grabado/capturado (ej. "Grabacion-1720368000000.webm"). */
export function formatRecordingFileName(prefix: string, timestampMs: number, extension: string): string {
  const safeExt = extension.replace(/^\./, "");
  return `${prefix}-${timestampMs}.${safeExt}`;
}

/**
 * Deriva un título por defecto a partir del nombre de archivo de una grabación (le saca la
 * extensión). Se usa como título automático al encolar una grabación (mic/captura de reunión),
 * que el usuario puede renombrar después desde el detalle de la transcripción.
 */
export function defaultTitleFromFileName(fileName: string): string {
  return (fileName ?? "").replace(/\.[^./\\]+$/, "");
}

/**
 * Normaliza un título editado inline en la cola de transcripción: recorta espacios y, si queda
 * vacío, vuelve al `fallback` (el título que tenía el ítem antes de editar) — así nunca se manda
 * un título vacío en el POST a /api/transcribe.
 */
export function normalizeQueueTitle(edited: string, fallback: string): string {
  const trimmed = (edited ?? "").trim();
  return trimmed || fallback;
}

export type ProjectNameResult = { ok: true; value: string } | { ok: false; error: string };

/** Valida y normaliza el nombre de un proyecto. */
export function validateProjectName(name: string): ProjectNameResult {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "El nombre no puede estar vacío." };
  if (trimmed.length > 60) return { ok: false, error: "El nombre no puede superar los 60 caracteres." };
  return { ok: true, value: trimmed };
}

/** Escapa un valor para usarlo como string YAML entre comillas dobles. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type MarkdownExportInput = {
  title: string;
  createdAt: string; // ISO
  projectName?: string | null;
  text: string;
};

/** Arma un .md con frontmatter YAML (title, date, project opcional) + el texto, listo para Obsidian. */
export function buildMarkdownExport({ title, createdAt, projectName, text }: MarkdownExportInput): string {
  const lines = ["---", `title: ${yamlString(title.trim() || "Sin título")}`, `date: ${yamlString(createdAt)}`];
  if (projectName) lines.push(`project: ${yamlString(projectName)}`);
  lines.push("---", "", text ?? "");
  return lines.join("\n");
}

export type ParsedMarkdownExport = { title: string | null; text: string };

/**
 * Inverso de `buildMarkdownExport`: separa el frontmatter YAML del cuerpo y extrae `title`.
 * Usado por el motor de sync de Drive (doc 09 Fase 2) al bajar un `.md` editado en Drive, para no
 * guardar el frontmatter como si fuera parte del texto de la transcripción.
 *
 * No es un parser YAML genérico — solo entiende el formato propio que genera `buildMarkdownExport`
 * (comillas dobles con `\"`/`\\` escapados). Si el contenido no tiene ese frontmatter (ej. un .md
 * que el usuario creó a mano en Drive, sin pasar por la app), devuelve `title: null` y el contenido
 * completo como texto, sin lanzar.
 */
export function parseMarkdownExport(content: string): ParsedMarkdownExport {
  const raw = content ?? "";
  const lines = raw.split("\n");

  if (lines[0] !== "---") return { title: null, text: raw };

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return { title: null, text: raw };

  let title: string | null = null;
  for (let i = 1; i < closingIndex; i++) {
    const match = lines[i].match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (match) {
      title = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      break;
    }
  }

  const bodyLines = lines.slice(closingIndex + 1);
  if (bodyLines[0] === "") bodyLines.shift(); // la línea en blanco que agrega buildMarkdownExport tras el "---"
  return { title, text: bodyLines.join("\n") };
}

/** Sanitiza un nombre para usarlo como nombre de archivo (sin caracteres inválidos en Windows/macOS). */
export function slugifyFileName(name: string, fallback = "transcripcion"): string {
  const cleaned = (name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  // Si después de sanitizar no queda contenido real (solo guiones/espacios), usamos el fallback.
  const hasContent = /[^\s-]/.test(cleaned);
  return hasContent ? cleaned : fallback;
}
