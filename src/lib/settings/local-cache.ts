import { DEFAULT_TRANSCRIPTION_SETTINGS, type TranscriptionDefaults } from "./user-settings";
import { resolveEngine, resolveLanguage, resolveQuality } from "./validate";

const CACHE_KEY = "transcribe:defaults";

// Compat: el idioma vivía en su propia clave (`transcribe:language`, ver historial de
// `transcribe-workspace.tsx`) antes de que existiera este sistema de defaults. Se sigue LEYENDO
// como fallback (usuarios que ya habían elegido un idioma antes de esta migración no lo pierden)
// pero deja de escribirse — `writeCachedDefaults` la limpia.
const LEGACY_LANGUAGE_KEY = "transcribe:language";

/**
 * Revalida un valor leído de `localStorage` contra la misma allowlist que ya usa el server (ver
 * `validate.ts`). `localStorage` es editable a mano (devtools) o puede quedar con un valor de una
 * versión vieja/futura de la app — sin este paso, un valor fuera de la allowlist llegaría directo
 * al `<select>` (sin `<option>` que lo matchee) y al FormData de `/api/transcribe`.
 */
function sanitize(partial: Partial<TranscriptionDefaults>): TranscriptionDefaults {
  return {
    engine: partial.engine !== undefined ? resolveEngine(partial.engine) : DEFAULT_TRANSCRIPTION_SETTINGS.engine,
    quality:
      partial.quality !== undefined ? resolveQuality(partial.quality) : DEFAULT_TRANSCRIPTION_SETTINGS.quality,
    language:
      partial.language !== undefined ? resolveLanguage(partial.language) : DEFAULT_TRANSCRIPTION_SETTINGS.language,
  };
}

/**
 * Lee el cache local de defaults de transcripción. Instantáneo (sin red) — pensado para
 * inicializar estado vía lazy initializer, nunca desde un `useEffect` (evita
 * `react-hooks/set-state-in-effect`). En el servidor (SSR) devuelve el default de fábrica.
 */
export function readCachedDefaults(): TranscriptionDefaults {
  if (typeof window === "undefined") return DEFAULT_TRANSCRIPTION_SETTINGS;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TranscriptionDefaults>;
      return sanitize(parsed);
    }
  } catch {
    // localStorage corrupto/inaccesible (modo privado, cuota, etc.): caemos al legado o al default.
  }

  try {
    const legacyLanguage = localStorage.getItem(LEGACY_LANGUAGE_KEY);
    if (legacyLanguage) return sanitize({ language: legacyLanguage });
  } catch {
    // ídem.
  }

  return DEFAULT_TRANSCRIPTION_SETTINGS;
}

/** Escribe el cache local tras confirmar (o asumir) un valor — espejo de lo guardado en Supabase. */
export function writeCachedDefaults(defaults: TranscriptionDefaults): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(defaults));
    localStorage.removeItem(LEGACY_LANGUAGE_KEY);
  } catch {
    // Storage lleno o deshabilitado: no rompemos el flujo de guardado por esto.
  }
}
