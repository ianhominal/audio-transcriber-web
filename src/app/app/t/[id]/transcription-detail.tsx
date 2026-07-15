"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { UIMessage } from "ai";
import { formatDate, formatFileSize, buildMarkdownExport, slugifyFileName } from "@/lib/format";
import { buildNoteMarkdown, buildNotePlainText, summaryToMarkdown } from "@/lib/noteExport";
import { requestGoogleDriveAccessToken, uploadMarkdownToDrive, DriveAuthError } from "@/lib/googleDrive";
import {
  updateTranscription,
  updateTranscriptionTags,
  assignTranscriptionToProject,
  deleteTranscription,
} from "../../actions";
import { EmojiPicker } from "../../emoji-picker";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import { useToast } from "@/components/ui/Toast";
import { useViewportClamp } from "@/hooks/useViewportClamp";
import { translationLanguageLabel } from "@/lib/translate/languages";
import { qualityLabel } from "@/lib/transcribe/model";
import { languageLabel } from "@/lib/settings/validate";
import { canSummarizeText } from "@/lib/summary/validate";
import type { SummaryResult } from "@/lib/summary/format";
import type { AiRecipe } from "@/lib/recipes/types";
import { ChatPanel } from "@/components/app/chat-panel";

const EXPORT_MENU_WIDTH = 256; // w-64

type Transcription = {
  id: string;
  title: string;
  audio_name: string;
  audio_size: number;
  audio_url: string | null;
  text: string;
  description: string;
  icon: string;
  language: string;
  model: string;
  project_id: string | null;
  created_at: string;
  // Fase F4 (traducción vía LLM): `null`/ausentes en transcripciones normales o si la migración
  // todavía no está aplicada (ver fallback en `page.tsx`) — nunca undefined en runtime real, pero
  // opcionales acá por si algún caller viejo no los manda.
  translated_to?: string | null;
  original_text?: string | null;
  // Vocabulario custom (ver ROADMAP.md): `true` si esta transcripción se corrigió con el
  // vocabulario del usuario (y de verdad cambió algo, ver `correctTextWithVocabulary`), `false` si
  // se intentó pero no hizo falta corregir nada, `null`/ausente si no aplica o la migración todavía
  // no está aplicada.
  vocabulary_corrected?: boolean | null;
  // Tags de tema (tanda 3 de quick wins, ver ROADMAP.md): generados automáticamente al transcribir
  // (best-effort) o quitados a mano desde acá — siempre un array (nunca undefined/null: la columna
  // es NOT NULL DEFAULT '{}' y `page.tsx` ya degrada a `[]` durante la ventana de rollout).
  tags: string[];
  // Auto-apply del Formato default al transcribir (ver
  // supabase/migrations/20260713130000_transcription_default_recipe.sql /
  // src/lib/recipes/autoApply.ts): `null` si el usuario no tenía formato default, si el auto-apply
  // falló/tardó de más, o si la migración todavía no está aplicada (`page.tsx` ya degrada a `null`
  // durante la ventana de rollout) — en cualquiera de esos casos el panel de abajo no se renderiza.
  // `default_recipe_name` es un snapshot del NOMBRE del formato al momento de aplicarlo (sigue
  // mostrándose igual aunque el formato se renombre o se borre después).
  default_recipe_output?: string | null;
  default_recipe_name?: string | null;
};

type Project = { id: string; name: string; icon: string };

export function TranscriptionDetail({
  transcription,
  projects,
  audioSrc,
  initialSummary,
  summaryStale,
  initialChatMessages,
}: {
  transcription: Transcription;
  projects: Project[];
  audioSrc: string | null;
  // Fase F5 (resumen con IA): ya vienen resueltos desde el server component (`page.tsx`) — parseo
  // de `summary` y comparación de hash contra `summary_source_hash` son server-only (ver
  // `src/lib/summary/hash.ts`, que usa `crypto` de Node), así que este componente cliente nunca
  // recibe el hash crudo, solo el resultado ya interpretado.
  initialSummary: SummaryResult | null;
  summaryStale: boolean;
  // Chat con IA (ver ROADMAP.md): historial ya resuelto a `UIMessage[]` desde el server component
  // (`page.tsx`, `rowsToUIMessages`) — mismo criterio que el resumen.
  initialChatMessages: UIMessage[];
}) {
  const router = useRouter();
  const { show: toast } = useToast();
  const [title, setTitle] = useState(transcription.title);
  const [text, setText] = useState(transcription.text);
  const [description, setDescription] = useState(transcription.description);
  const [icon, setIcon] = useState(transcription.icon);
  // Baseline contra el que se compara "hay cambios sin guardar" (`dirty`). Se actualiza recién
  // cuando `save()` confirma éxito — NO se lee/escribe `transcription` (prop) directamente: mutar
  // props/argumentos de hook está prohibido (ver `react-hooks/immutability`).
  const [baseline, setBaseline] = useState({
    title: transcription.title,
    text: transcription.text,
    description: transcription.description,
    icon: transcription.icon,
  });
  const [projectId, setProjectId] = useState<string | null>(transcription.project_id);
  // Tags (tanda 3 de quick wins): guardado INMEDIATO al quitar un chip (ver `removeTag`), mismo
  // criterio que `projectId`/`changeProject` — no pasa por el flujo `dirty`/"Guardar" de
  // título/texto/descripción/ícono.
  const [tags, setTags] = useState(transcription.tags);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingDrive, setExportingDrive] = useState(false);
  // Export a .docx/.pdf (ver brief "Exportar Word/PDF" 2026-07-13): mismo criterio que
  // `exportingDrive` — un booleano propio por formato, no un enum compartido, para no tocar el
  // patrón ya usado por Drive.
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // Fase F4: solo aplica a transcripciones traducidas (`translated_to`+`original_text` ambos
  // presentes) — arranca oculto, el texto principal (`text`) ya es el traducido.
  const [showOriginal, setShowOriginal] = useState(false);
  // Fase F5 (resumen con IA). `summaryText` es el `text` EXACTO al que corresponde `summary` — se
  // usa para derivar "¿está desactualizado?" comparando contra el `text` actual (mismo criterio
  // que `dirty` más abajo: derivado, no un booleano propio que se pueda desincronizar). Arranca en
  // `null` (sentinela que nunca matchea) si `summaryStale` vino en `true` desde el server —así el
  // resumen inicial recibido ya nace marcado como desactualizado sin tener que adivinar a qué
  // texto viejo correspondía.
  const [summary, setSummary] = useState(initialSummary);
  const [summaryText, setSummaryText] = useState(summaryStale ? null : transcription.text);
  const [summarizing, setSummarizing] = useState(false);
  // "Aplicar formato" (ver brief "Formatos" 2026-07-13). A diferencia del resumen/chat (historial
  // resuelto server-side en `page.tsx`), la lista de formatos se trae client-side al montar: es un
  // fetch chico e independiente (no bloquea el render inicial de la nota) y evita tener que resolver
  // `user.id` en el server component solo para esto (`page.tsx` hoy no lo necesita para nada más).
  const [recipes, setRecipes] = useState<AiRecipe[]>([]);
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyOutput, setApplyOutput] = useState("");
  const [applyDone, setApplyDone] = useState(false);
  const [savingApplyNote, setSavingApplyNote] = useState(false);
  const [applyNoteSavedId, setApplyNoteSavedId] = useState<string | null>(null);
  // Panel "Formato aplicado" (auto-apply del formato default al transcribir, ver
  // src/lib/recipes/autoApply.ts): estado propio de "Guardar como nota" — INDEPENDIENTE del de
  // "Aplicar formato" (manual) de arriba, son dos resultados/fuentes distintas.
  const [savingDefaultRecipeNote, setSavingDefaultRecipeNote] = useState(false);
  const [defaultRecipeNoteSavedId, setDefaultRecipeNoteSavedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recipes");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = (data.recipes ?? []) as AiRecipe[];
        setRecipes(list);
        const defaultRecipe = list.find((r) => r.isDefault);
        setSelectedRecipeId(defaultRecipe?.id ?? list[0]?.id ?? "");
      } catch {
        // Best-effort: sin formatos disponibles la tarjeta queda vacía, no rompe el resto del detalle.
      } finally {
        if (!cancelled) setRecipesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Menú "Exportar": portal a `document.body` + clampeo al viewport (mismo patrón que `IconMenu`,
  // extraído a `useViewportClamp`) — antes era `absolute left-0 w-64` sin clamp, así que en
  // pantallas angostas (~360-390px) se salía por el borde derecho.
  const {
    coords: exportCoords,
    triggerRef: exportTriggerRef,
    panelRef: exportPanelRef,
  } = useViewportClamp(exportOpen, EXPORT_MENU_WIDTH, { align: "left" });

  useEffect(() => {
    if (!exportOpen) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (exportTriggerRef.current?.contains(target) || exportPanelRef.current?.contains(target)) return;
      setExportOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExportOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
    // Los refs son estables entre renders — no hace falta re-suscribir salvo que cambie `exportOpen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOpen]);

  // Foco al abrir/cerrar (bugfix LOW #11, review adversarial 2026-07-10) — mismo criterio que
  // `IconMenu`: al abrir, el foco entra al primer ítem del menú; al cerrar vuelve al botón
  // "Exportar" que lo abrió.
  useEffect(() => {
    if (!exportOpen) return;
    const trigger = exportTriggerRef.current;
    const panel = exportPanelRef.current;
    const target = panel?.querySelector<HTMLElement>('[role="menuitem"]');
    target?.focus();
    return () => {
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOpen]);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? null;

  // Hay cambio real si cambió el título, el texto, la descripción o el ícono respecto del baseline.
  const dirty =
    title !== baseline.title ||
    text !== baseline.text ||
    description !== baseline.description ||
    icon !== baseline.icon;

  // Fase F5: no tiene sentido resumir un texto casi vacío (ver `MIN_SUMMARY_TEXT_LENGTH`), y
  // resumir mientras hay cambios de texto sin guardar generaría un resumen que no corresponde a lo
  // que está persistido — se pide guardar primero, mismo criterio de "una sola fuente de verdad"
  // que ya usa el backend (`/api/summarize` lee `text` de la DB, no lo que mande el cliente).
  const summaryTooShort = !canSummarizeText(text);
  const summaryOutOfDate = summary !== null && text !== summaryText;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const res = await updateTranscription(transcription.id, { title, text, description, icon });
    setSaving(false);
    if (res.ok) {
      setBaseline({ title, text, description, icon });
      setJustSaved(true);
      toast("Guardado.", "success");
      setTimeout(() => setJustSaved(false), 2000);
      router.refresh(); // refresca la lista/título en el resto de la app
    } else {
      toast(res.error ?? "No se pudo guardar.", "error");
    }
  }

  /**
   * Genera (o regenera) el resumen con IA — Fase F5. `force: true` cuando ya hay un resumen
   * visible: en ese caso no tiene sentido pedirle al server que devuelva el cache (ya lo estamos
   * mostrando), el click significa "quiero uno nuevo".
   */
  async function summarize() {
    setSummarizing(true);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: transcription.id, force: summary !== null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo generar el resumen.", "error");
        return;
      }
      setSummary({ summary: data.summary, keyPoints: data.keyPoints ?? [], actionItems: data.actionItems ?? [] });
      setSummaryText(text);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setSummarizing(false);
    }
  }

  /**
   * Aplica el formato elegido a esta transcripción — lee la respuesta en streaming (texto plano,
   * `/api/recipes/apply`, ver comentario del route) y la va renderizando a medida que llega, mismo
   * criterio de feedback progresivo que el chat (`useChat`), pero acá manual porque no es un mensaje
   * de chat: es un resultado único que se muestra en la tarjeta.
   */
  async function applyRecipe() {
    if (!selectedRecipeId || applying || dirty) return;
    setApplying(true);
    setApplyOutput("");
    setApplyDone(false);
    setApplyNoteSavedId(null);
    try {
      const res = await fetch("/api/recipes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptionId: transcription.id, recipeId: selectedRecipeId }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? "No se pudo aplicar el formato.", "error");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setApplyOutput(acc);
      }
      setApplyDone(true);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setApplying(false);
    }
  }

  /** "Guardar como nota" del resultado del formato — mismo endpoint/shape que usa el chat
   * (`POST /api/notes`, ver `chat-panel.tsx`). */
  async function saveApplyOutputAsNote() {
    if (!applyOutput.trim() || savingApplyNote) return;
    setSavingApplyNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: applyOutput }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo guardar la nota.", "error");
        return;
      }
      setApplyNoteSavedId(data.id);
      toast("Guardado ✓", "success");
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setSavingApplyNote(false);
    }
  }

  /** "Guardar como nota" del resultado del Formato aplicado AUTOMÁTICAMENTE al transcribir (panel
   * "Formato aplicado", ver `default_recipe_output`) — mismo endpoint/shape que
   * `saveApplyOutputAsNote` de arriba (aplicación manual), pero con su propio estado: son dos
   * resultados independientes, guardarlos no debe interferir entre sí. */
  async function saveDefaultRecipeOutputAsNote() {
    const output = transcription.default_recipe_output;
    if (!output || !output.trim() || savingDefaultRecipeNote) return;
    setSavingDefaultRecipeNote(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: output }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo guardar la nota.", "error");
        return;
      }
      setDefaultRecipeNoteSavedId(data.id);
      toast("Guardado ✓", "success");
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setSavingDefaultRecipeNote(false);
    }
  }

  async function changeProject(value: string) {
    const next = value === "" ? null : value;
    // Bugfix LOW #9 (review adversarial 2026-07-10): antes se seteaba `projectId` optimista y se
    // ignoraba el `ActionResult` de `assignTranscriptionToProject` (que devuelve `{ ok: false }` en
    // vez de lanzar) — si el server rechazaba el move, el <select> quedaba mostrando un proyecto al
    // que la transcripción en realidad NUNCA se movió, sin ningún aviso. Se captura el valor previo
    // para poder revertir, mismo patrón que `remove()`/`save()` en este mismo archivo.
    const previous = projectId;
    setProjectId(next);
    const res = await assignTranscriptionToProject(transcription.id, next);
    if (!res.ok) {
      setProjectId(previous);
      toast(res.error ?? "No se pudo mover la transcripción.", "error");
    }
  }

  /** Quita un tag (chip "×" en Etiquetas) — guardado optimista con revert si falla, mismo patrón
   * que `changeProject`. */
  async function removeTag(tag: string) {
    const previous = tags;
    const next = previous.filter((t) => t !== tag);
    setTags(next);
    const res = await updateTranscriptionTags(transcription.id, next);
    if (!res.ok) {
      setTags(previous);
      toast(res.error ?? "No se pudo quitar la etiqueta.", "error");
    }
  }

  /**
   * Baja la NOTA completa (título + fecha + resumen si existe + transcripción) como .txt plano —
   * antes bajaba solo la transcripción cruda. Ver `buildNotePlainText` (quick win "sacar el output
   * afuera", 2026-07-11). El nombre ahora se deriva del TÍTULO igual que `exportMarkdown`/
   * `exportNoteMarkdown` (antes usaba `audio_name` sin slugificar).
   */
  function download() {
    const txt = buildNotePlainText({
      title: title || transcription.audio_name,
      createdAt: transcription.created_at,
      projectName,
      text,
      summary,
    });
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFileName(title || transcription.audio_name)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadAudio() {
    if (!audioSrc) return;
    // La URL firmada es cross-origin: bajamos el blob para forzar la descarga.
    const resp = await fetch(audioSrc);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = transcription.audio_name || "audio";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    const md = buildMarkdownExport({
      title: title || transcription.audio_name,
      createdAt: transcription.created_at,
      projectName,
      text,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFileName(title || transcription.audio_name)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    toast("Exportado como Markdown.", "success");
  }

  /**
   * Nota completa (título + fecha + resumen si existe + transcripción) como Markdown "de lectura"
   * bien estructurado (headings/negrita/viñetas) — para pegar en Docs/Notion o archivar suelta.
   *
   * Distinta de `exportMarkdown()` de arriba a propósito: ESA genera el formato
   * frontmatter+cuerpo que el motor de sync de Drive lee de vuelta con `parseMarkdownExport` (todo
   * lo que sigue al frontmatter se guarda tal cual como `transcriptions.text`, ver el comentario en
   * `src/lib/format.ts`) — meterle acá una sección de resumen corrompería la transcripción en el
   * próximo sync desde Drive. Por eso es una función y un ítem de menú separados, no una opción
   * más del export a Obsidian/Drive.
   */
  function exportNoteMarkdown() {
    const md = buildNoteMarkdown({
      title: title || transcription.audio_name,
      createdAt: transcription.created_at,
      projectName,
      text,
      summary,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFileName(title || transcription.audio_name)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    toast("Nota exportada.", "success");
  }

  /**
   * Nota completa como .docx. Carga "docx" con un `import()` dinámico DENTRO del handler (no a
   * nivel de módulo) para que Turbopack lo separe en su propio chunk que solo baja al hacer click
   * acá — ver `docxExport.ts` para el motivo (nunca importar "docx" de forma estática en un archivo
   * que pueda tocarse durante SSR).
   */
  async function exportDocx() {
    setExportOpen(false);
    setExportingDocx(true);
    try {
      const { exportNoteAsDocx } = await import("@/lib/docxExport");
      const blob = await exportNoteAsDocx({
        title: title || transcription.audio_name,
        createdAt: transcription.created_at,
        projectName,
        text,
        summary,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugifyFileName(title || transcription.audio_name)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Exportado como Word.", "success");
    } catch {
      toast("No se pudo exportar como Word.", "error");
    } finally {
      setExportingDocx(false);
    }
  }

  /**
   * Nota completa como .pdf. Mismo criterio que `exportDocx` de arriba (import dinámico de
   * "jspdf" adentro del handler). `exportNoteAsPdf` devuelve la instancia de `jsPDF` en vez de un
   * Blob: su propio método `.save()` ya arma la descarga (Blob + `<a>`) internamente, no hace falta
   * repetir ese paso acá.
   */
  async function exportPdf() {
    setExportOpen(false);
    setExportingPdf(true);
    try {
      const { exportNoteAsPdf } = await import("@/lib/pdfExport");
      const doc = await exportNoteAsPdf({
        title: title || transcription.audio_name,
        createdAt: transcription.created_at,
        projectName,
        text,
        summary,
      });
      doc.save(`${slugifyFileName(title || transcription.audio_name)}.pdf`);
      toast("Exportado como PDF.", "success");
    } catch {
      toast("No se pudo exportar como PDF.", "error");
    } finally {
      setExportingPdf(false);
    }
  }

  async function exportDrive() {
    // Pide un access token de Drive ON-DEMAND con Google Identity Services (modelo de token), NO
    // con el login de Supabase: así no dependemos de su provider_token (frágil, no se refresca) ni
    // hace falta re-loguear a nadie. Ver investigación en el changelog del 2026-07-07.
    setExportOpen(false);
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    setExportingDrive(true);
    try {
      const accessToken = await requestGoogleDriveAccessToken(clientId);
      const md = buildMarkdownExport({
        title: title || transcription.audio_name,
        createdAt: transcription.created_at,
        projectName,
        text,
      });
      await uploadMarkdownToDrive({
        accessToken,
        fileName: `${slugifyFileName(title || transcription.audio_name)}.md`,
        content: md,
      });
      toast("Guardado en tu Google Drive.", "success");
    } catch (e) {
      const message =
        e instanceof DriveAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No se pudo exportar a Google Drive.";
      toast(message, "error");
    } finally {
      setExportingDrive(false);
    }
  }

  async function remove() {
    if (!confirm("¿Borrar esta transcripción? También se borra su audio. No se puede deshacer.")) return;
    const res = await deleteTranscription(transcription.id);
    if (res.ok) {
      router.push("/app");
      router.refresh();
    } else {
      toast(res.error ?? "No se pudo borrar.", "error");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <EmojiPicker value={icon} onChange={setIcon} />
          <div className="min-w-0 flex-1">
            {/* Título editable propio (independiente del nombre del archivo) */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={transcription.audio_name || "Sin título"}
              aria-label="Título de la transcripción"
              className="w-full rounded-md border border-transparent bg-transparent text-2xl font-bold tracking-tight text-foreground outline-none transition-colors duration-150 ease-out hover:border-border focus:border-accent focus:bg-surface"
            />
            {/* "text" en vez de "audio" para notas text-only (ej. "Guardar como nota" del chat, ver
                ROADMAP.md) — mostrar un ícono de audio para algo que nunca tuvo audio confundía. */}
            <p className="mt-0.5 flex items-center gap-1 px-0.5 text-xs text-tertiary">
              <Icon name={transcription.audio_url ? "audio" : "text"} className="shrink-0" />
              {transcription.audio_name}
            </p>
          </div>
        </div>
        <span className="shrink-0 pt-2 text-xs text-tertiary">{formatDate(transcription.created_at)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-tertiary">
        {transcription.model && <Badge>{qualityLabel(transcription.model)}</Badge>}
        <Badge>{languageLabel(transcription.language)}</Badge>
        {transcription.audio_size > 0 && <Badge>{formatFileSize(transcription.audio_size)}</Badge>}
        {transcription.translated_to && (
          <Badge tone="brand">
            <Icon name="translate" size={12} className="shrink-0" />
            Traducido a {translationLanguageLabel(transcription.translated_to)}
          </Badge>
        )}
        {transcription.vocabulary_corrected && (
          <Badge tone="brand">
            <Icon name="vocabulary" size={12} className="shrink-0" />
            Corregido con tu vocabulario
          </Badge>
        )}
      </div>

      {/* Tags de tema (tanda 3 de quick wins, ver ROADMAP.md): generados automáticamente al
          transcribir, editables (solo quitar por ahora — ver `updateTranscriptionTags`). */}
      {tags.length > 0 && (
        <div className="mt-3">
          <p id="tags-heading" className="text-xs font-semibold uppercase tracking-wide text-tertiary">
            Etiquetas
          </p>
          <ul aria-labelledby="tags-heading" role="list" className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-accent-subtle py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-accent-subtle-text"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Quitar la etiqueta ${tag}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full leading-none text-accent-subtle-text/70 transition hover:bg-black/10 hover:text-accent-subtle-text dark:hover:bg-white/10"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Descripción / notas */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Descripción o notas (opcional)…"
        aria-label="Descripción o notas"
        className="mt-4 w-full resize-y rounded-lg border border-border-strong p-3 text-sm text-secondary focus:border-accent focus:outline-none"
      />

      {/* Reproductor: usa una URL firmada temporal (bucket privado). */}
      {audioSrc ? (
        <audio controls src={audioSrc} className="mt-4 w-full" />
      ) : (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-background px-3 py-2 text-xs text-tertiary">
          <Icon name="headphones" className="shrink-0" />
          El audio de esta transcripción todavía no está guardado.
        </p>
      )}

      {/* Asignar a proyecto */}
      <div className="mt-5 flex items-center gap-2">
        <label htmlFor="project" className="text-sm text-secondary">
          Proyecto:
        </label>
        <select
          id="project"
          value={projectId ?? ""}
          onChange={(e) => changeProject(e.target.value)}
          className="rounded-lg border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
        >
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ""}
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Texto original pre-traducción (Fase F4) — solo si esta transcripción se tradujo. El
          texto principal de abajo (`text`) ya es el traducido; esto es una referencia opcional,
          no editable (editar el original no tendría efecto — el LLM no vuelve a correr). */}
      {transcription.translated_to && transcription.original_text && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
            aria-controls="original-text-panel"
            className="text-xs font-semibold text-accent hover:underline"
          >
            {showOriginal ? "Ocultar texto original" : "Ver texto original (antes de traducir)"}
          </button>
          {showOriginal && (
            <p
              id="original-text-panel"
              className="mt-1.5 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm text-tertiary"
            >
              {transcription.original_text}
            </p>
          )}
        </div>
      )}

      {/* Texto editable */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        aria-label="Texto de la transcripción"
        className="mt-5 w-full resize-y rounded-xl border border-border-strong p-4 text-foreground focus:border-accent focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty} loading={saving} variant={justSaved ? "success" : "primary"}>
          {saving ? "Guardando…" : justSaved ? "Guardado ✓" : "Guardar"}
        </Button>
        <CopyButton text={text} label="Copiar" ariaLabel="Copiar la transcripción completa" size="md" />
        <Button variant="secondary" onClick={download}>
          Descargar .txt
        </Button>
        {audioSrc && (
          <Button variant="secondary" onClick={downloadAudio}>
            Descargar audio
          </Button>
        )}
        <div className="relative">
          <button
            ref={exportTriggerRef}
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            className={buttonClasses({ variant: "secondary" })}
          >
            Exportar
            <Icon name="chevron-down" className="shrink-0" />
          </button>
          {exportOpen &&
            createPortal(
              <div
                ref={exportPanelRef}
                role="menu"
                style={{
                  position: "fixed",
                  top: exportCoords?.top ?? -9999,
                  left: exportCoords?.left ?? -9999,
                  width: EXPORT_MENU_WIDTH,
                  visibility: exportCoords ? "visible" : "hidden",
                }}
                // z-50: mismo nivel que IconMenu/EmojiPicker (ver jerarquía en
                // `components/ui/Modal.tsx`), para mantener una escala de z-index coherente entre
                // todos los popovers porteados de la app.
                className="z-50 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
              >
                <p className="px-3 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-tertiary">Descargar</p>
                <button
                  role="menuitem"
                  onClick={exportMarkdown}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-secondary transition hover:bg-surface-secondary"
                >
                  <Icon name="file-md" className="shrink-0" /> Obsidian / Markdown (.md)
                </button>
                <button
                  role="menuitem"
                  onClick={exportNoteMarkdown}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-secondary transition hover:bg-surface-secondary"
                >
                  <Icon name="note" className="shrink-0" /> Nota completa (.md)
                </button>
                <button
                  role="menuitem"
                  onClick={exportDocx}
                  disabled={exportingDocx}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-secondary transition hover:bg-surface-secondary disabled:opacity-50"
                >
                  {exportingDocx ? <Spinner size="xs" /> : <Icon name="file-doc" className="shrink-0" />} {exportingDocx ? "Exportando…" : "Nota completa (.docx)"}
                </button>
                <button
                  role="menuitem"
                  onClick={exportPdf}
                  disabled={exportingPdf}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-secondary transition hover:bg-surface-secondary disabled:opacity-50"
                >
                  {exportingPdf ? <Spinner size="xs" /> : <Icon name="note" className="shrink-0" />} {exportingPdf ? "Exportando…" : "Nota completa (.pdf)"}
                </button>
                <div className="my-1 border-t border-border" role="separator" />
                <p className="px-3 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-tertiary">Enviar a la nube</p>
                <button
                  role="menuitem"
                  onClick={exportDrive}
                  disabled={exportingDrive}
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-secondary transition hover:bg-surface-secondary disabled:opacity-50"
                >
                  {exportingDrive ? <Spinner size="xs" /> : <Icon name="drive" className="shrink-0" />} {exportingDrive ? "Exportando…" : "Google Drive"}
                </button>
              </div>,
              document.body
            )}
        </div>
        <Button variant="danger-outline" onClick={remove} className="sm:ml-auto">
          Borrar
        </Button>
      </div>

      {/* Resumen con IA (Fase F5) */}
      <div className="mt-5 rounded-xl border border-border-strong bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Resumen con IA</h3>
          <Button
            variant="secondary"
            size="sm"
            loading={summarizing}
            disabled={summarizing || summaryTooShort || dirty}
            title={
              summaryTooShort
                ? "El texto es muy corto para resumir."
                : dirty
                  ? "Guardá los cambios de texto antes de generar el resumen."
                  : undefined
            }
            onClick={summarize}
          >
            {summarizing ? "Generando…" : summary ? "Regenerar" : "Resumir"}
          </Button>
        </div>

        {/* Región viva: un lector de pantalla anuncia cuándo empieza a generar y cuándo aparece el
            resumen, sin que el usuario tenga que ir a buscarlo. `aria-live="polite"` para no
            interrumpir lo que esté leyendo. */}
        <div role="status" aria-live="polite">
          {summarizing && <p className="mt-2 text-xs text-tertiary">Generando el resumen…</p>}
          {!summary && !summarizing && summaryTooShort && (
            <p className="mt-2 text-xs text-tertiary">Este texto es muy corto para generar un resumen.</p>
          )}
          {!summary && !summarizing && !summaryTooShort && (
            <p className="mt-2 text-xs text-tertiary">
              Generá un resumen breve con puntos clave y tareas, sin releer todo el texto.
            </p>
          )}

          {summary && (
            <div className="mt-3 space-y-3">
              {summaryOutOfDate && (
                <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
                  <Icon name="warning" className="shrink-0" />
                  El texto cambió desde que se generó este resumen — puede estar desactualizado.
                </p>
              )}
              {/* Renderizado como Markdown restringido (quick win "renderizar markdown en pantalla",
                  2026-07-11) — antes se mostraban crudos (`**`/`##` a la vista si el modelo los
                  usaba). Mismo `<MarkdownContent>` que las respuestas del chat, ver `chat-panel.tsx`. */}
              <MarkdownContent text={summary.summary} className="text-sm text-secondary" />
              {summary.keyPoints.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">Puntos clave</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-secondary">
                    {summary.keyPoints.map((point, i) => (
                      <li key={i}>
                        <MarkdownContent text={point} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.actionItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">Tareas y próximos pasos</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-secondary">
                    {summary.actionItems.map((item, i) => (
                      <li key={i}>
                        <MarkdownContent text={item} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <CopyButton text={summaryToMarkdown(summary)} label="Copiar resumen" ariaLabel="Copiar el resumen" />
            </div>
          )}
        </div>
      </div>

      {/* Aplicar formato (ver brief "Formatos" 2026-07-13): instrucciones reutilizables guardadas en
          Ajustes → Formatos, aplicadas con un click a esta nota. Mismo patrón visual de tarjeta que
          "Resumen con IA" — bloqueada mientras hay cambios sin guardar, mismo criterio que ese botón
          y que el chat (la IA siempre trabaja sobre el texto GUARDADO, nunca sobre un borrador). */}
      <div className="mt-5 rounded-xl border border-border-strong bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground">Aplicar formato</h3>

        {recipesLoaded && recipes.length === 0 ? (
          <p className="mt-2 text-xs text-tertiary">
            Todavía no creaste ningún formato (brief, guion, hooks…).{" "}
            <Link href="/app/ajustes" className="font-semibold text-accent hover:underline">
              Creá tu primer formato
            </Link>{" "}
            para aplicarlo con un toque acá.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selectedRecipeId}
              onChange={(e) => setSelectedRecipeId(e.target.value)}
              disabled={applying || dirty || recipes.length === 0}
              aria-label="Elegir formato"
              className="min-w-0 flex-1 rounded-lg border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent disabled:opacity-60"
            >
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}
                  {recipe.isDefault ? " · predeterminado" : ""}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              loading={applying}
              disabled={applying || dirty || !selectedRecipeId}
              title={dirty ? "Guardá los cambios de texto antes de aplicar un formato." : undefined}
              onClick={applyRecipe}
            >
              {applying ? "Generando…" : "Aplicar"}
            </Button>
          </div>
        )}

        {/* Región viva, mismo criterio que el panel de Resumen: se anuncia cuándo empieza a generar
            y cuándo aparece el resultado, sin que la usuaria tenga que ir a buscarlo. */}
        <div role="status" aria-live="polite">
          {applying && !applyOutput && <p className="mt-2 text-xs text-tertiary">Generando…</p>}
          {applyOutput && (
            <div className="mt-3 space-y-3">
              <MarkdownContent text={applyOutput} className="text-sm text-secondary" />
              {applyDone && (
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton text={applyOutput} label="Copiar" ariaLabel="Copiar el resultado del formato" />
                  {applyNoteSavedId ? (
                    <Link
                      href={`/app/t/${applyNoteSavedId}`}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      Guardado ✓ · Ver nota
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={saveApplyOutputAsNote}
                      disabled={savingApplyNote}
                      className="text-xs font-medium text-tertiary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingApplyNote ? "Guardando…" : "Guardar como nota"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Formato aplicado automáticamente al transcribir (auto-apply del formato default, ver
          src/lib/recipes/autoApply.ts / supabase/migrations/20260713130000_transcription_default_recipe.sql).
          Solo se renderiza si el auto-apply corrió y tuvo éxito — si el usuario no tiene formato
          default, o el auto-apply falló/tardó de más, `default_recipe_output` viene `null` y esta
          sección no agrega NADA al detalle (el resto de la pantalla queda exactamente igual). Mismo
          patrón visual/de acciones que la tarjeta "Aplicar formato" (manual) de arriba, para
          consistencia — pero es contenido YA generado (no hay botón "Aplicar" ni estado "Generando…"
          acá, el resultado ya está persistido en la fila). */}
      {transcription.default_recipe_output && (
        <section
          aria-labelledby="default-recipe-heading"
          className="mt-5 rounded-xl border border-border-strong bg-surface p-4"
        >
          <h3 id="default-recipe-heading" className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Icon name="sparkles" className="shrink-0" />
            Formato aplicado: {transcription.default_recipe_name || "Formato"}
          </h3>
          <div className="mt-3 space-y-3">
            <MarkdownContent text={transcription.default_recipe_output} className="text-sm text-secondary" />
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton
                text={transcription.default_recipe_output}
                label="Copiar"
                ariaLabel={`Copiar el resultado de ${transcription.default_recipe_name || "el formato"} aplicado`}
              />
              {defaultRecipeNoteSavedId ? (
                <Link
                  href={`/app/t/${defaultRecipeNoteSavedId}`}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Guardado ✓ · Ver nota
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={saveDefaultRecipeOutputAsNote}
                  disabled={savingDefaultRecipeNote}
                  aria-label="Guardar como nota el resultado del formato aplicado"
                  className="text-xs font-medium text-tertiary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDefaultRecipeNote ? "Guardando…" : "Guardar como nota"}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Chat con IA sobre esta transcripción (MVP por-transcripción, ver ROADMAP.md). Bloqueado
          mientras hay cambios de texto sin guardar — mismo criterio que el botón de Resumen: la IA
          siempre responde en base al texto GUARDADO (lo que lee `/api/chat` de la DB), nunca al
          borrador visible en el textarea de abajo. */}
      <ChatPanel
        transcriptionId={transcription.id}
        initialMessages={initialChatMessages}
        disabled={dirty}
        disabledReason={dirty ? "Guardá los cambios de texto antes de usar el chat." : undefined}
      />
    </div>
  );
}
