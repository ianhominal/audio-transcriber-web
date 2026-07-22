"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildMergeRequestBody } from "./request";

/**
 * "Combinar en documento" ("merge into one document") logic — manual streaming + save-as-note —
 * extracted from `merge-view.tsx` (feature 2026-07-13) so it can be reused AS-IS by the "Combinar en
 * documento" action embedded in the project-scoped assistant (`ChatPanel`, feature 2026-07-22 phase
 * 2). Without this hook, the `fetch` + `res.body.getReader()` + header-reading logic would be
 * duplicated across two components. `merge-view.tsx` (`/app/merge` page) also switched to this hook,
 * with no behavior change (same fetch, same headers, same error handling).
 *
 * Does NOT use `useChat` — this is a DIFFERENT streaming protocol than chat's (plain text +
 * `X-Merge-Truncated`/`X-Merge-Included-Count`, not the UIMessage/SSE protocol), see the header
 * comment on `/api/notes/merge`. `toast` is injected (instead of calling `useToast()` in here) so the
 * caller decides how to surface errors/success with ITS OWN `useToast()` instance — avoids coupling
 * this hook to living inside a tree with one particular `ToastProvider`.
 */
export function useMergeStream(toast: (message: string, kind: "error" | "success") => void) {
  const router = useRouter();
  const [merging, setMerging] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [includedCount, setIncludedCount] = useState<number | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSavedId, setNoteSavedId] = useState<string | null>(null);

  async function mergeNotes(transcriptionIds: string[], instruction: string) {
    if (merging) return;
    setMerging(true);
    setOutput("");
    setDone(false);
    setTruncated(false);
    setIncludedCount(null);
    setNoteSavedId(null);
    try {
      const res = await fetch("/api/notes/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMergeRequestBody(transcriptionIds, instruction)),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast(data.error ?? "Llegaste al límite diario de uniones. Probá de nuevo mañana.", "error");
        } else if (res.status === 404) {
          toast(data.error ?? "No pudimos encontrar alguna de las notas elegidas.", "error");
        } else {
          toast(data.error ?? "No se pudo unir las notas.", "error");
        }
        return;
      }

      // Read BEFORE consuming the body — same reason documented in the route: the plain-text stream
      // carries no embedded marker to transmit this metadata.
      setTruncated(res.headers.get("X-Merge-Truncated") === "true");
      const includedHeader = res.headers.get("X-Merge-Included-Count");
      setIncludedCount(includedHeader ? Number(includedHeader) : null);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        acc += decoder.decode(value, { stream: true });
        setOutput(acc);
      }
      setDone(true);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setMerging(false);
    }
  }

  /** "Save as note" for the merged document — same endpoint/shape as the rest of the app
   * (`POST /api/notes`, see `saveApplyOutputAsNote` in `transcription-detail.tsx`). Navigates to the
   * new note after saving, same criteria `merge-view.tsx` already had. */
  async function saveAsNote() {
    if (!output.trim() || savingNote) return;
    setSavingNote(true);
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
      setNoteSavedId(data.id);
      toast("Guardado ✓", "success");
      router.push(`/app/t/${data.id}`);
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setSavingNote(false);
    }
  }

  return { merging, output, done, truncated, includedCount, savingNote, noteSavedId, mergeNotes, saveAsNote };
}
