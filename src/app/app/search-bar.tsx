"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { SearchSnippetSegment } from "@/lib/search/snippet";

type SearchResult = {
  id: string;
  title: string;
  createdAt: string;
  projectId: string | null;
  snippet: SearchSnippetSegment[];
};

/** Debounce for live search — chico a propósito (búsqueda de texto, gratis, sin costo de IA) pero
 * igual evita disparar un fetch por cada tecla. */
const DEBOUNCE_MS = 250;

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief) — barra de búsqueda full-text sobre TODAS las
 * notas del usuario (`GET /api/notes/search`), scopeada por dueño en el server (ver ese route). Se
 * monta una sola vez en el dashboard (`page.tsx`), fuera de la navegación por proyecto/carpeta — la
 * búsqueda es intencionalmente GLOBAL, no respeta el filtro de proyecto activo.
 *
 * Combobox accesible (patrón WAI-ARIA "Editable Combobox With List Autocomplete"): `role="combobox"`
 * + `aria-expanded`/`aria-controls`/`aria-activedescendant` en el input, `role="listbox"`/`"option"`
 * en los resultados, navegación completa por teclado (↓/↑ mueve la selección, Enter la abre, Escape
 * cierra). El click abre la nota directamente (`/app/t/<id>`), mismo destino que
 * `TranscriptionRow`.
 */
export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup-only on unmount — no `setState` here (an effect that only clears a timer/aborts a
  // fetch on unmount is exactly what effects are for; the actual state updates below all happen
  // inside event handlers or their async callbacks, never synchronously in an effect body, per
  // `react-hooks/set-state-in-effect`).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  /** Fires on every keystroke: updates `query` immediately (controlled input) and either clears the
   * results right away (empty query — nothing to debounce) or schedules a debounced fetch. All state
   * updates happen HERE (an event handler) or inside the `setTimeout`/`fetch` callbacks it schedules
   * — never as a direct side effect of a render via `useEffect`. */
  function onQueryChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (!trimmed) {
      abortRef.current?.abort();
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(`/api/notes/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then(async (res) => {
          const data = await res.json();
          setResults(res.ok ? (data.results ?? []) : []);
          setActiveIndex(-1);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setResults([]);
          setActiveIndex(-1);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
  }

  function goTo(id: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    router.push(`/app/t/${id}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      goTo(results[activeIndex].id);
    }
  }

  const showDropdown = open && query.trim().length > 0;

  return (
    <div className="relative mb-4">
      <label htmlFor="dashboard-search" className="sr-only">
        Buscar en tus notas
      </label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
          🔎
        </span>
        <input
          id="dashboard-search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay para que el `onMouseDown` de una opción (más abajo) llegue a disparar ANTES de
            // que el blur cierre la lista — si cerráramos en `onBlur` directamente, el click nunca
            // llegaría a ejecutarse.
            window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar en tus notas…"
          autoComplete="off"
          className="w-full rounded-xl border border-border-strong bg-surface py-2.5 pl-9 pr-3 text-sm text-foreground shadow-sm transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Resultados de búsqueda"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-sm text-tertiary">Buscando…</li>}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-tertiary">No encontramos notas para &quot;{query.trim()}&quot;.</li>
          )}
          {!loading &&
            results.map((result, i) => (
              <li
                key={result.id}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // `onMouseDown` (no `onClick`): corre ANTES de `onBlur` del input, así el click
                // navega en vez de perderse porque la lista ya se cerró.
                onMouseDown={(e) => {
                  e.preventDefault();
                  goTo(result.id);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer rounded-lg px-3 py-2 transition ${
                  i === activeIndex ? "bg-accent-subtle" : "hover:bg-surface-secondary"
                }`}
              >
                <p
                  className={`truncate text-sm font-medium ${
                    i === activeIndex ? "text-accent-subtle-text" : "text-foreground"
                  }`}
                >
                  {result.title}
                </p>
                {result.snippet.length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-tertiary">
                    {result.snippet.map((segment, si) =>
                      segment.match ? (
                        <mark key={si} className="rounded bg-transparent font-semibold text-accent">
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={si}>{segment.text}</span>
                      )
                    )}
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
