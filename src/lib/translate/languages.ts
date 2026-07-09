/**
 * Idiomas destino soportados por "Transcribir y traducir" (Fase F4, ver ROADMAP.md item 6).
 * Lista CURADA — no hay "otro idioma" libre — mismo criterio que la paleta de `project-colors.ts`
 * (F2): nunca se le manda al LLM un valor arbitrario que vino tal cual del cliente.
 */
export const TRANSLATION_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "pt", label: "Portugués" },
  { code: "fr", label: "Francés" },
  { code: "it", label: "Italiano" },
  { code: "de", label: "Alemán" },
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]["code"];

// Inglés por default: es el destino más pedido para traducir DESDE español (el idioma de
// transcripción por default, ver `DEFAULT_LANGUAGE` en `@/lib/settings/validate`) — traducir "es
// a es" por default no tendría sentido.
export const DEFAULT_TRANSLATION_LANGUAGE: TranslationLanguageCode = "en";

const ALLOWED_TRANSLATION_CODES = TRANSLATION_LANGUAGES.map((l) => l.code);

/** Valida el idioma destino pedido contra la allowlist; cualquier otro valor cae al default. */
export function resolveTranslationLanguage(input: unknown): TranslationLanguageCode {
  if (typeof input !== "string") return DEFAULT_TRANSLATION_LANGUAGE;
  const trimmed = input.trim();
  return (ALLOWED_TRANSLATION_CODES as readonly string[]).includes(trimmed)
    ? (trimmed as TranslationLanguageCode)
    : DEFAULT_TRANSLATION_LANGUAGE;
}

/** Nombre legible de un código de idioma destino — usado en el prompt del LLM y en la UI. */
export function translationLanguageLabel(code: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** Modo de la corrida: transcribir tal cual, o transcribir + traducir el texto resultante. */
export const TRANSCRIBE_MODES = ["transcribe", "translate"] as const;
export type TranscribeMode = (typeof TRANSCRIBE_MODES)[number];
export const DEFAULT_TRANSCRIBE_MODE: TranscribeMode = "transcribe";

/** Valida el modo pedido contra la allowlist; cualquier otro valor cae al default ("transcribe"). */
export function resolveTranscribeMode(input: unknown): TranscribeMode {
  if (typeof input !== "string") return DEFAULT_TRANSCRIBE_MODE;
  const trimmed = input.trim();
  return (TRANSCRIBE_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as TranscribeMode)
    : DEFAULT_TRANSCRIBE_MODE;
}
