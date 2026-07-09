"use client";

import { useCallback, useState } from "react";

/**
 * Generaliza "default persistente + override puntual" para UN campo (ver ROADMAP.md ítem F1):
 * el valor efectivo es el override si el usuario tocó ESTE campo para la tanda actual, o el
 * default persistido si no. Evita duplicar la tripleta estado-override/restaurar/fijar-default
 * por cada selector de `TranscribeWorkspace` (Idioma, Calidad).
 *
 * `isDefault` compara por VALOR, no solo "¿hay override?" — si el usuario reabre el `<select>` y
 * elige a propósito el mismo valor que ya era el default, sigue contando como default (pill
 * "Default"), no como "Modificado" por un cambio que en los hechos es un no-op.
 */
export function useOverridableDefault(defaultValue: string, persist: (value: string) => Promise<unknown>) {
  const [override, setOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = override ?? defaultValue;
  const isDefault = override === null || override === defaultValue;

  const change = useCallback((next: string) => setOverride(next), []);
  const restore = useCallback(() => setOverride(null), []);

  const setAsDefault = useCallback(async () => {
    setSaving(true);
    try {
      await persist(value);
      setOverride(null);
    } finally {
      setSaving(false);
    }
  }, [persist, value]);

  return { value, isDefault, saving, change, restore, setAsDefault };
}
