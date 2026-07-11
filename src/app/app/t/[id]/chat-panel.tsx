"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import { useToast } from "@/components/ui/Toast";
import { isValidChatMessageText, MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat/config";
import { parseChatErrorMessage } from "@/lib/chat/errors";
import { getMessageText, shouldRenderMarkdown } from "@/lib/chat/message";

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
 * `prepareSendMessagesRequest` manda SOLO el mensaje nuevo (no el array completo de `messages`) —
 * el server reconstruye el historial leyendo `chat_messages` directamente (ver
 * `src/app/api/chat/route.ts`), corrección del review adversarial: un cliente que mandara el
 * historial completo podía inflarlo arbitrariamente o inyectar roles falsos sin que ningún cap lo
 * frenara.
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
  const { show: toast } = useToast();
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    id: transcriptionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages: current }) => ({
        body: { transcriptionId, message: current[current.length - 1] },
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const inputDisabled = disabled || busy;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || inputDisabled) return;
    // Mismo cap que valida el server (`isValidChatMessageText`, ver `src/lib/chat/config.ts`) —
    // corrección del review adversarial: antes un mensaje demasiado largo se mandaba igual, quedaba
    // "atascado" en el historial local con un 400 sin explicación clara y un "Reintentar" que iba a
    // fallar exactamente igual (el texto sigue siendo el mismo). Validar acá evita el viaje inútil.
    if (!isValidChatMessageText(trimmed)) {
      toast(`Tu mensaje es muy largo (máximo ${MAX_CHAT_MESSAGE_CHARS.toLocaleString("es-AR")} caracteres).`, "error");
      return;
    }
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
          pantalla sin que tenga que ir a buscarlo. `role="log"` es el patrón ARIA pensado para este
          caso (transcripción de conversación que crece), a diferencia de `role="status"` que usa el
          panel de Resumen (un único bloque de resultado, no una lista que se acumula). SIN
          `aria-relevant` explícito a propósito (corrección del review adversarial): restringirlo a
          `"additions"` deja de anunciar las MUTACIONES de texto de un mensaje ya insertado — y la
          respuesta de la IA se arma así, como texto que se va completando dentro de la MISMA burbuja
          a medida que llega el stream. El default del rol (`"additions text"`) sí cubre ambos casos. */}
      <div role="log" aria-live="polite" className="mt-3 max-h-96 space-y-3 overflow-y-auto">
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
              {/* Respuestas del asistente se renderizan como Markdown restringido (`markdownToSafeHtml`,
                  quick win "renderizar markdown en pantalla", 2026-07-11) — antes se veían con los
                  `**`/`##` crudos a la vista. Los mensajes de la usuaria quedan en texto plano
                  (`shouldRenderMarkdown`, ver `src/lib/chat/message.ts`): ella escribe preguntas, no
                  Markdown. Seguro durante el streaming sin ningún manejo especial acá: cada re-render
                  vuelve a parsear el `part.text` COMPLETO hasta ese momento desde cero (sin estado
                  incremental), y `markdownToSafeHtml` nunca deja una tag a medio abrir para ningún
                  prefijo posible del texto (verificado con un test dedicado en `markdown.test.ts`) —
                  así que un `**negrita` o un `## Título` a medio llegar simplemente se ve como
                  asteriscos/numerales literales hasta que el cierre llega, nunca rompe el layout. */}
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
            {/* Copiar respuesta (quick win "sacar el output afuera", 2026-07-11) — solo en las
                respuestas de la IA, no en los mensajes de la usuaria (nada nuevo que copiar ahí,
                ella ya lo escribió). `getMessageText` junta las partes "text" del mensaje, mismo
                filtro que ya aplica el render de arriba. */}
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
              Pensando…
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
          disabled={inputDisabled}
          placeholder="Escribí tu pregunta…"
          aria-label="Mensaje para la IA"
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {busy ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => stop()}>
            Detener
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={disabled || !input.trim()}>
            Enviar
          </Button>
        )}
      </form>
    </div>
  );
}
