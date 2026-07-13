"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import { isValidBrainQuestionText, MAX_BRAIN_QUESTION_CHARS } from "@/lib/brain/config";
import { parseChatErrorMessage } from "@/lib/chat/errors";
import { getMessageText, shouldRenderMarkdown } from "@/lib/chat/message";

const SUGGESTIONS = [
  "¿Qué dije sobre mi proyecto últimamente?",
  "Juntá mis ideas sobre marketing",
  "¿Tengo alguna tarea pendiente en mis notas?",
];

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief): chat con IA sobre TODAS las notas del usuario,
 * contra `POST /api/brain`. A diferencia de `ChatPanel` (chat por-transcripción, con historial
 * persistido en `chat_messages`), acá cada pregunta es INDEPENDIENTE — no hay `initialMessages` ni
 * persistencia server-side, ver el comment de cabecera de `/api/brain/route.ts` para por qué
 * (evita reintroducir la vulnerabilidad de historial fabricado por el cliente que `/api/chat` ya
 * corrigió). `messages` sigue viviendo en memoria del lado del cliente (para que la conversación se
 * VEA como una sola sesión mientras la pestaña sigue abierta), pero cada pregunta nueva viaja SOLA —
 * mismo `prepareSendMessagesRequest` que `ChatPanel`.
 */
export function BrainChat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    id: "brain",
    transport: new DefaultChatTransport({
      api: "/api/brain",
      prepareSendMessagesRequest: ({ messages: current }) => ({
        body: { message: current[current.length - 1] },
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!isValidBrainQuestionText(trimmed)) {
      return;
    }
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="rounded-xl border border-border-strong bg-surface p-4">
      {/* Región viva: cada mensaje nuevo se anuncia a un lector de pantalla — mismo criterio que
          `ChatPanel` (`role="log"`, sin `aria-relevant` restringido: el texto de la respuesta se
          actualiza DENTRO de la misma burbuja mientras llega el stream). */}
      <div role="log" aria-live="polite" className="max-h-[28rem] space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submit(suggestion)}
                disabled={busy}
                className="rounded-full border border-border-strong bg-background px-3 py-1.5 text-xs text-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-brand-600 px-3.5 py-2 text-sm text-white"
                  : "max-w-[85%] rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-foreground"
              }
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? (
                  shouldRenderMarkdown(message.role) ? (
                    <MarkdownContent key={i} text={part.text} />
                  ) : (
                    <span key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  )
                ) : null
              )}
            </div>
            {message.role !== "user" && (
              <div className="mt-1">
                <CopyButton text={getMessageText(message)} label="Copiar" ariaLabel="Copiar esta respuesta" size="sm" />
              </div>
            )}
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-tertiary">
              Buscando en tus notas…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-400/15 dark:text-red-200">
          <span>{parseChatErrorMessage(error)}</span>
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
          disabled={busy}
          placeholder="Preguntá sobre todas tus notas…"
          aria-label="Pregunta para el Segundo cerebro"
          maxLength={MAX_BRAIN_QUESTION_CHARS}
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {busy ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => stop()}>
            Detener
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!input.trim()}>
            Enviar
          </Button>
        )}
      </form>
    </div>
  );
}
