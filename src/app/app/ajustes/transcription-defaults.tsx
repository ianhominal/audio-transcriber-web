"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useTranscriptionDefaults } from "@/lib/settings/use-transcription-defaults";
import type { TranscriptionDefaults } from "@/lib/settings/user-settings";

type SavingField = "language" | "quality" | null;

/**
 * Sección "Transcripción" de Ajustes: edita los defaults persistentes (Motor/Calidad/Idioma) que
 * `TranscribeWorkspace` usa para pre-seleccionar cada vez — ver ROADMAP.md, ítem F1.
 *
 * Autoguarda al cambiar cada selector (sin botón "Guardar" aparte, mismo criterio que un panel de
 * Configuración estilo VS Code). `initialDefaults` viene del server component (ya resuelto contra
 * Supabase) y se usa como semilla del hook — cero flicker en esta pantalla.
 */
export function TranscriptionDefaultsSection({
  initialDefaults,
}: {
  initialDefaults: TranscriptionDefaults;
}) {
  const { show: toast } = useToast();
  const { defaults, save } = useTranscriptionDefaults(initialDefaults);
  // Estado de guardado por campo (no un único `saving` compartido): cambiar Idioma no debe
  // deshabilitar el selector de Calidad mientras esa escritura está en vuelo, y viceversa.
  const [savingField, setSavingField] = useState<SavingField>(null);

  async function changeQuality(value: string) {
    setSavingField("quality");
    try {
      await save({ quality: value });
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar la calidad.", "error");
    } finally {
      setSavingField(null);
    }
  }

  async function changeLanguage(value: string) {
    setSavingField("language");
    try {
      await save({ language: value });
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar el idioma.", "error");
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-lg" aria-hidden="true">
          🎙️
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Transcripción</h2>
          <p className="text-sm text-tertiary">
            Defaults para cada transcripción nueva. Se pueden cambiar puntualmente al transcribir sin tocar esto.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold text-tertiary">Idioma</span>
          <select
            value={defaults.language}
            onChange={(e) => changeLanguage(e.target.value)}
            disabled={savingField === "language"}
            className="rounded-lg border border-border-strong px-3 py-2 focus:border-accent disabled:opacity-60"
          >
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="auto">Automático</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-semibold text-tertiary">Calidad</span>
          <select
            value={defaults.quality}
            onChange={(e) => changeQuality(e.target.value)}
            disabled={savingField === "quality"}
            className="rounded-lg border border-border-strong px-3 py-2 focus:border-accent disabled:opacity-60"
          >
            <option value="whisper-large-v3-turbo">Rápida (turbo)</option>
            <option value="whisper-large-v3">Máxima (large-v3)</option>
          </select>
        </label>
        <div className="flex flex-col text-sm">
          <span className="mb-1 font-semibold text-tertiary">Motor</span>
          <p className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-background px-3 py-2 text-secondary">
            Groq Whisper
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-tertiary">
        Por ahora la web transcribe solo con Groq — el selector de Motor se habilita cuando sumemos otro proveedor acá.
      </p>
    </div>
  );
}
