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
