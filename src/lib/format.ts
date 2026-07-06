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

export type ProjectNameResult = { ok: true; value: string } | { ok: false; error: string };

/** Valida y normaliza el nombre de un proyecto. */
export function validateProjectName(name: string): ProjectNameResult {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "El nombre no puede estar vacío." };
  if (trimmed.length > 60) return { ok: false, error: "El nombre no puede superar los 60 caracteres." };
  return { ok: true, value: trimmed };
}
