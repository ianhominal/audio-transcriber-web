"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readCachedDefaults, writeCachedDefaults } from "./local-cache";
import type { TranscriptionDefaults } from "./user-settings";

/**
 * Defaults persistentes de transcripción (Motor/Calidad/Idioma), compartidos entre la sección
 * "Transcripción" de Ajustes y `TranscribeWorkspace`.
 *
 * Patrón: cache local primero (instantáneo, sin flicker) → revalida contra Supabase en
 * background → si difiere, actualiza. La inicialización es un lazy initializer (lee
 * `localStorage` directo al crear el estado) y la revalidación ocurre dentro de una función
 * async nombrada llamada desde el efecto — NO un `setState` síncrono en el cuerpo del efecto —
 * mismo patrón que ya usa `DriveFolderConnect` en este repo para no disparar
 * `react-hooks/set-state-in-effect`.
 *
 * `initial` es opcional: cuando el server component ya trajo el valor real (ver
 * `transcribe/page.tsx` y `ajustes/page.tsx`), se usa como semilla en vez del cache —así esas
 * pantallas ni flickean ni dependen de una revalidación extra en el primer render.
 */
export function useTranscriptionDefaults(initial?: TranscriptionDefaults) {
  const [defaults, setDefaults] = useState<TranscriptionDefaults>(() => initial ?? readCachedDefaults());
  const [saving, setSaving] = useState(false);
  // Guardia anti-carrera: la revalidación de montaje y un `save()` disparado por el usuario (ej.
  // clickear "Fijar como default" apenas entra a la pantalla) corren en paralelo. Sin esto, si el
  // GET de revalidación resuelve DESPUÉS de que un `save()` ya confirmó un valor más nuevo, pisaría
  // ese valor con el más viejo (perdido silenciosamente, sin error visible para el usuario).
  const savedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function revalidate() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = (await res.json()) as TranscriptionDefaults;
        if (!cancelled && !savedRef.current) {
          setDefaults(data);
          writeCachedDefaults(data);
        }
      } catch {
        // Sin red o sesión aún no lista: seguimos con el cache/semilla del server.
      }
    }

    revalidate();
    return () => {
      cancelled = true;
    };
    // Solo al montar: cada pantalla revalida una vez, no en cada cambio de `defaults`.
  }, []);

  /** Persiste un patch parcial contra Supabase y actualiza el estado local + cache al confirmar. */
  const save = useCallback(async (patch: Partial<TranscriptionDefaults>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo guardar la preferencia.");
      const saved = body as TranscriptionDefaults;
      savedRef.current = true;
      setDefaults(saved);
      writeCachedDefaults(saved);
      return saved;
    } finally {
      setSaving(false);
    }
  }, []);

  return { defaults, saving, save };
}
