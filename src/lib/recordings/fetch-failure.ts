/**
 * Turns whatever `fetch` threw into something both the user and we can act on.
 *
 * Background: a tester queued 14 audio files on an Android phone and every upload failed. The
 * server logs showed ZERO requests — nothing left the device. The old code did `catch {}` and threw
 * the exception away, so the screen said "no se pudo conectar" for every case and we could not tell
 * a dead network from a file handle Android had already invalidated.
 *
 * That distinction matters because the fixes are opposite: one is "esperá a tener señal", the other
 * is "volvé a elegir el archivo". Guessing wrong sends the person down the wrong path.
 */

export type FetchFailureKind = "network" | "unreadable-file" | "aborted" | "unknown";

export type FetchFailure = {
  kind: FetchFailureKind;
  /** User-facing, plain language. */
  message: string;
  /** Technical detail kept for diagnosis — surfaced in the recording's `lastError`. */
  detail: string;
};

/**
 * Android hands out `content://` references from whatever app provided the file. Those go stale:
 * the provider releases the permission and reading the blob to build the request body throws,
 * before any network call happens.
 */
const UNREADABLE_MARKERS = [/could not be read/i, /could not be found at the time/i, /permission denied/i];

function nameOf(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

export function describeFetchFailure(error: unknown): FetchFailure {
  const name = nameOf(error);
  const raw = messageOf(error);
  const detail = `${name}: ${raw}`.trim();

  if (name === "NotReadableError" || name === "NotFoundError" || UNREADABLE_MARKERS.some((m) => m.test(raw))) {
    return {
      kind: "unreadable-file",
      message:
        "El teléfono ya no deja leer ese archivo. Suele pasar con audios que vienen de otra app: " +
        "volvé a elegirlo y probá de nuevo.",
      detail,
    };
  }

  if (name === "AbortError") {
    return { kind: "aborted", message: "La subida se cortó antes de terminar. Probá de nuevo.", detail };
  }

  if (error instanceof TypeError || /failed to fetch|network|load failed/i.test(raw)) {
    return {
      kind: "network",
      message:
        "No se pudo conectar con el servidor. La grabación quedó guardada en este dispositivo: " +
        "reintentá cuando tengas señal.",
      detail,
    };
  }

  // Anything we did not foresee still reaches the screen WITH its technical detail. Swallowing it
  // is exactly what left us blind the first time.
  return {
    kind: "unknown",
    message: `No se pudo subir el archivo (${detail}). Quedó guardado en este dispositivo.`,
    detail,
  };
}
