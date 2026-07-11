"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Button } from "@/components/ui/Button";

const SUGGESTIONS = [
  "Resumí esto",
  "¿Cuáles son las ideas principales?",
  "Armá una lista de tareas",
  "Escribí un mensaje con esto",
];

/**
 * Chat con IA sobre UNA transcripción (MVP por-transcripción, ver ROADMAP.md). Usa `useChat` del AI
 * SDK v6 (`@ai-sdk/react`) contra `/api/chat` — el historial (`initialMessages`) ya viene resuelto
 * desde el server component (`page.tsx`), mismo criterio que el resumen: el cliente no reinterpreta
 * filas de DB, solo recibe el shape final.
 *
 * `disabled`/`disabledReason` (pasados desde `transcription-detail.tsx`) bloquean el envío mientras
 * hay cambios de texto sin guardar — mismo criterio que el panel de Resumen (`summarize()`), para que
 * la IA nunca responda en base a un texto viejo mientras la usuaria ve otro en pantalla.
 */
export function ChatPanel({
  transcriptionId,
  initialMessages,
  disabled,
  disabledReason,
}: {
  transcriptionId: string;
  initialMessages: UIMessage[];
  disabled: boolean;
  disabledReason?: string;
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat({
    id: transcriptionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { transcriptionId },
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const inputDisabled = disabled || busy;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || inputDisabled) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="mt-5 rounded-xl border border-border-strong bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">💬 Chat con IA</h3>
      <p className="mt-1 text-xs text-tertiary">
        Preguntale a la IA sobre esta transcripción: pedile un resumen, ideas clave, una lista de
        tareas o lo que necesites.
      </p>

      {disabled && disabledReason && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
          ⚠️ {disabledReason}
        </p>
      )}

      {/* Región viva: cada mensaje nuevo (de la usuaria o de la IA) se anuncia a un lector de
          pantalla sin que tenga que ir a buscarlo — `role="log"` es el patrón ARIA pensado para
          este caso (transcripción de conversación que crece), a diferencia de `role="status"` que
          usa el panel de Resumen (un único bloque de resultado, no una lista que se acumula). */}
      <div role="log" aria-live="polite" aria-relevant="additions" className="mt-3 max-h-96 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submit(suggestion)}
                disabled={inputDisabled}
                className="rounded-full border border-border-strong bg-background px-3 py-1.5 text-xs text-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-brand-600 px-3.5 py-2 text-sm text-white"
                  : "max-w-[85%] rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-foreground"
              }
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? (
                  <span key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </span>
                ) : null
              )}
            </div>
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-tertiary">
              Pensando…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-400/15 dark:text-red-300">
          <span>No pudimos generar la respuesta.</span>
          <button type="button" onClick={() => regenerate()} className="font-semibold underline">
            Reintentar
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={inputDisabled}
          placeholder="Escribí tu pregunta…"
          aria-label="Mensaje para la IA"
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={inputDisabled || !input.trim()} loading={status === "submitted"}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
