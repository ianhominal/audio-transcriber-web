"use client";

import { useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/Toast";
import { isValidChatMessageText, MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat/config";
import { parseChatErrorMessage } from "@/lib/chat/errors";
import { getMessageText, shouldRenderMarkdown } from "@/lib/chat/message";
import { resolveChatRequestConfig, type ChatScope } from "@/lib/chat/scope";
import { isValidBrainQuestionText, MAX_BRAIN_QUESTION_CHARS } from "@/lib/brain/config";

/** Estado de "Guardar como nota" (quick win del brainstorm "Sacar el output afuera", ver
 * ROADMAP.md) por mensaje — un `Record` keyeado por `message.id` en vez de un booleano único
 * porque cualquier respuesta del asistente puede guardarse, no solo la última. Solo aplica al
 * scope "note" — el scope "all" ("Todas mis notas") nunca tuvo esta feature (ver la extinta
 * `BrainChat`) y no se le inventa acá. */
type SaveNoteState = { status: "idle" | "saving" | "saved" | "error"; noteId?: string };

const NOTE_SUGGESTIONS = [
  "Resumí esto",
  "¿Cuáles son las ideas principales?",
  "Armá una lista de tareas",
  "Escribí un mensaje con esto",
];

const ALL_SUGGESTIONS = [
  "¿Qué dije sobre mi proyecto últimamente?",
  "Juntá mis ideas sobre marketing",
  "¿Tengo alguna tarea pendiente en mis notas?",
];

/**
 * Chat con IA unificado — UN solo componente, UN solo mental model para la usuaria: "Chat con
 * IA" con un selector de ALCANCE ("Esta nota" / "Todas mis notas") en vez de dos features
 * separadas (antes: `ChatPanel` por-transcripción + `BrainChat`/"Segundo cerebro" global, cada
 * una con su propia página y su propio chat). El backend NO cambia — sigue habiendo dos
 * endpoints (`/api/chat` y `/api/brain`, ver esos routes), solo cambia CUÁL llama el frontend
 * según el scope elegido. `resolveChatRequestConfig` (`src/lib/chat/scope.ts`) es el mapeo puro
 * scope → { api, body }, testeado sin mockear nada.
 *
 * Dos instancias de `useChat` conviven SIEMPRE montadas (regla de hooks: no se puede llamar un
 * hook condicionalmente) — `noteChat` contra `/api/chat`, `allChat` contra `/api/brain` — y
 * `active` selecciona cuál se usa para renderizar/enviar según `scope`. Cada una mantiene su
 * PROPIO historial en memoria: `noteChat` arranca con `initialMessages` (persistido en
 * `chat_messages`, resuelto por el server component, ver `page.tsx`); `allChat` arranca vacío y
 * se queda así por diseño (ver comment de cabecera de `/api/brain/route.ts`: no hay
 * `initialMessages` ni persistencia server-side para el scope "all", a propósito, para no
 * reintroducir la vulnerabilidad de historial fabricado por el cliente que `/api/chat` ya
 * corrigió). Cambiar el `<select>` de scope simplemente cambia CUÁL de las dos historias se ve
 * en pantalla — no se mezclan ni se pisan.
 *
 * El selector de scope solo se muestra cuando hay `transcriptionId` (la página por-nota tiene
 * ambos scopes disponibles). La página standalone "Todas mis notas" (`/app/brain`) no tiene
 * contexto de nota — queda fija en scope "all", sin selector, sin necesidad de un picker de
 * notas (fuera de alcance).
 *
 * `prepareSendMessagesRequest` manda SOLO el mensaje nuevo (no el array completo de `messages`,
 * vía `resolveChatRequestConfig`) — el server reconstruye el historial leyendo `chat_messages`
 * directamente para el scope "note" (ver `src/app/api/chat/route.ts`), corrección del review
 * adversarial: un cliente que mandara el historial completo podía inflarlo arbitrariamente o
 * inyectar roles falsos sin que ningún cap lo frenara.
 *
 * `disabled`/`disabledReason` (pasados desde `transcription-detail.tsx`) bloquean el envío
 * mientras hay cambios de texto sin guardar — mismo criterio que el panel de Resumen
 * (`summarize()`), para que la IA nunca responda en base a un texto viejo mientras la usuaria ve
 * otro en pantalla. Solo tiene sentido para scope "note" (atado a UNA transcripción puntual); el
 * scope "all" nunca se bloquea por esto.
 */
export function ChatPanel({
  transcriptionId,
  initialMessages = [],
  disabled = false,
  disabledReason,
  defaultScope = transcriptionId ? "note" : "all",
}: {
  transcriptionId?: string;
  initialMessages?: UIMessage[];
  disabled?: boolean;
  disabledReason?: string;
  defaultScope?: ChatScope;
}) {
  const { show: toast } = useToast();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<ChatScope>(defaultScope);

  const noteChat = useChat({
    id: transcriptionId ?? "note-chat-inactive",
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages: current }) => ({
        body: resolveChatRequestConfig("note", transcriptionId, current[current.length - 1]).body,
      }),
    }),
  });

  const allChat = useChat({
    id: "brain",
    transport: new DefaultChatTransport({
      api: "/api/brain",
      prepareSendMessagesRequest: ({ messages: current }) => ({
        body: resolveChatRequestConfig("all", undefined, current[current.length - 1]).body,
      }),
    }),
  });

  // Guardia defensiva: "note" sin `transcriptionId` no es un estado alcanzable desde el selector
  // (solo se muestra con `transcriptionId` presente), pero un futuro caller podría pasar
  // `defaultScope="note"` sin `transcriptionId` por error — en vez de que `resolveChatRequestConfig`
  // explote al enviar, degradamos a "all" acá, en un único lugar (hallazgo del review adversarial).
  const effectiveScope: ChatScope = scope === "note" && !transcriptionId ? "all" : scope;

  const active = effectiveScope === "note" ? noteChat : allChat;
  const { messages, sendMessage, status, error, regenerate, stop } = active;

  const busy = status === "submitted" || status === "streaming";
  // El bloqueo por `disabled` (cambios de texto sin guardar) solo aplica al scope "note" — el
  // scope "all" no está atado a ninguna transcripción puntual, así que nunca se bloquea por esto.
  const scopeBlocked = effectiveScope === "note" && disabled;
  const inputDisabled = scopeBlocked || busy;
  const [saveNoteState, setSaveNoteState] = useState<Record<string, SaveNoteState>>({});

  const suggestions = effectiveScope === "note" ? NOTE_SUGGESTIONS : ALL_SUGGESTIONS;
  const placeholder = effectiveScope === "note" ? "Escribí tu pregunta…" : "Preguntá sobre todas tus notas…";
  const inputAriaLabel = effectiveScope === "note" ? "Mensaje para la IA" : "Pregunta sobre todas tus notas";
  const pendingText = effectiveScope === "note" ? "Pensando…" : "Buscando en tus notas…";
  const maxLength = effectiveScope === "all" ? MAX_BRAIN_QUESTION_CHARS : undefined;

  /**
   * "Guardar como nota" (quick win del brainstorm, ver ROADMAP.md): crea una transcripción
   * text-only nueva con el contenido de ESTA respuesta del asistente (`POST /api/notes`, ver
   * `src/lib/notes/chatNote.ts` para cómo se arma el título/tag). Guardado independiente por
   * mensaje — `saveNoteState` es un mapa, no un booleano único, porque cualquier respuesta puede
   * guardarse, no solo la última. Solo se invoca (ver JSX abajo) para scope "note" — el scope
   * "all" nunca tuvo esta feature.
   */
  async function saveAsNote(message: UIMessage) {
    const text = getMessageText(message);
    if (!text.trim() || saveNoteState[message.id]?.status === "saving") return;
    setSaveNoteState((s) => ({ ...s, [message.id]: { status: "saving" } }));
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveNoteState((s) => ({ ...s, [message.id]: { status: "error" } }));
        toast(data.error ?? "No se pudo guardar la nota.", "error");
        return;
      }
      setSaveNoteState((s) => ({ ...s, [message.id]: { status: "saved", noteId: data.id } }));
      toast("Guardado ✓", "success");
    } catch {
      setSaveNoteState((s) => ({ ...s, [message.id]: { status: "error" } }));
      toast("No se pudo contactar al servidor.", "error");
    }
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || inputDisabled) return;
    // Mismo cap que valida el server para cada scope (`isValidChatMessageText`/
    // `isValidBrainQuestionText`) — corrección del review adversarial original: antes un mensaje
    // demasiado largo se mandaba igual, quedaba "atascado" en el historial local con un 400 sin
    // explicación clara y un "Reintentar" que iba a fallar exactamente igual (el texto sigue
    // siendo el mismo). Validar acá evita el viaje inútil.
    if (effectiveScope === "note") {
      if (!isValidChatMessageText(trimmed)) {
        toast(`Tu mensaje es muy largo (máximo ${MAX_CHAT_MESSAGE_CHARS.toLocaleString("es-AR")} caracteres).`, "error");
        return;
      }
    } else if (!isValidBrainQuestionText(trimmed)) {
      toast(`Tu pregunta es muy larga (máximo ${MAX_BRAIN_QUESTION_CHARS.toLocaleString("es-AR")} caracteres).`, "error");
      return;
    }
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="mt-5 rounded-xl border border-border-strong bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Chat con IA</h3>
        {transcriptionId && (
          <div>
            <label htmlFor="chat-scope" className="sr-only">
              Alcance del chat
            </label>
            <select
              id="chat-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as ChatScope)}
              className="rounded-lg border border-border-strong bg-background px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
            >
              <option value="note">Esta nota</option>
              <option value="all">Todas mis notas</option>
            </select>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-tertiary">
        {effectiveScope === "note"
          ? "Preguntale a la IA sobre esta transcripción: pedile un resumen, ideas clave, una lista de tareas o lo que necesites."
          : "Preguntale a la IA sobre todas tus notas: pedile que junte ideas repartidas en varias transcripciones, que te recuerde qué dijiste sobre un tema, o que busque tareas pendientes."}
      </p>

      {effectiveScope === "note" && disabled && disabledReason && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
          <Icon name="warning" className="shrink-0" />
          {disabledReason}
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
            {suggestions.map((suggestion) => (
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
                  ? "max-w-[85%] break-words rounded-2xl bg-brand-600 px-3.5 py-2 text-sm text-white"
                  : "max-w-[85%] break-words rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-foreground"
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
                    <span key={i} className="whitespace-pre-wrap break-words">
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
              <div className="mt-1 flex items-center gap-3">
                <CopyButton text={getMessageText(message)} label="Copiar" ariaLabel="Copiar esta respuesta" size="sm" />
                {/* "Guardar como nota" (quick win "Sacar el output afuera", ver ROADMAP.md): solo
                    para scope "note" — el scope "all" ("Todas mis notas") nunca tuvo esta feature,
                    no se le inventa comportamiento nuevo acá. Una vez guardada, el botón se
                    reemplaza por un link directo a la nota nueva — no tiene sentido dejar guardar
                    la misma respuesta dos veces seguidas. */}
                {effectiveScope === "note" &&
                  (saveNoteState[message.id]?.status === "saved" ? (
                    <Link
                      href={`/app/t/${saveNoteState[message.id]!.noteId}`}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      Guardado ✓ · Ver nota
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => saveAsNote(message)}
                      disabled={saveNoteState[message.id]?.status === "saving"}
                      className="text-xs font-medium text-tertiary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saveNoteState[message.id]?.status === "saving" ? "Guardando…" : "Guardar como nota"}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-background px-3.5 py-2 text-sm text-tertiary">
              {pendingText}
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
          placeholder={placeholder}
          aria-label={inputAriaLabel}
          maxLength={maxLength}
          className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {busy ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => stop()}>
            Detener
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={scopeBlocked || !input.trim()}>
            Enviar
          </Button>
        )}
      </form>
    </div>
  );
}
