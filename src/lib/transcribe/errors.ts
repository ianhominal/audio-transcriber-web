/**
 * Maps a transcription-provider (Groq) failure to a message we can actually show a person.
 *
 * The provider's own `error.message` must NEVER reach the UI: it's English, technical, and leaks
 * internals (org ids, model names, billing links). Real example we shipped by accident:
 * "Request too large for model `whisper-large-v3` in organization `org_01k...` service tier
 * `on_demand` on seconds of audio per day (ASPD): Limit 28800, Requested 42762 (...) Upgrade to
 * Dev Tier today at https://console.groq.com/settings/billing".
 *
 * Gotcha worth remembering: Groq answers **413**, not 429, when the account's daily audio-seconds
 * quota (ASPD) runs out — so status alone can't tell "this one file is too big" apart from "the
 * whole account is out of quota for today". The message is the only signal, hence the sniffing.
 */
export function friendlyTranscribeError(status: number, providerMessage?: string | null): string {
  const msg = (providerMessage ?? "").toLowerCase();

  // Daily audio-seconds quota for the whole account (shared across users): comes back as 413.
  if (msg.includes("seconds of audio per day") || msg.includes("aspd")) {
    return "Llegamos al límite de audio por hoy. Probá de nuevo mañana, o usá la app de escritorio, que transcribe en tu compu sin límite.";
  }

  // Per-request size cap (a genuinely huge file).
  if (status === 413) {
    return "El audio es muy largo para procesarlo de una. Probá con uno más corto, o usá la app de escritorio.";
  }

  if (status === 429) {
    return "El servicio está saturado en este momento. Probá de nuevo en un rato.";
  }

  if (status === 400) {
    return "No pudimos procesar ese audio. Puede estar dañado o en un formato que no soportamos.";
  }

  if (status === 401 || status === 403) {
    return "El servicio de transcripción no está disponible en este momento.";
  }

  if (status >= 500) {
    return "El servicio de transcripción tuvo un problema. Probá de nuevo en un momento.";
  }

  return "No se pudo completar la transcripción. Probá de nuevo.";
}
