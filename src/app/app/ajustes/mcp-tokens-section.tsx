"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/icon";
import { formatDate } from "@/lib/format";
import { MAX_MCP_TOKEN_LABEL_LENGTH } from "@/lib/mcp-tokens/validate";
import type { McpTokenSummary } from "@/lib/mcp-tokens/store";

/**
 * "Conexión MCP" section in Settings (Phase 2 — see `.claude/resources/changelog/2026-07-11.md`):
 * issue/revoke the tokens an external MCP client (Claude, ChatGPT, etc.) uses to read the user's
 * transcriptions via `/api/mcp` (Phase 1, read-only). Same approach as `VocabularySection`: local
 * `useState` seeded with `initialTokens` (resolved server-side, no flicker), mutations that update
 * local state only once the server confirms, error toast on failure, `busyId` disables ONLY the
 * row currently in flight.
 *
 * "Reveal once" pattern — new in this app (no existing "copy to clipboard" or "reveal secret once"
 * component to reuse — searched, zero matches): `revealedToken` lives ONLY while the reveal modal
 * is open — closing it clears it from React state immediately (not just visually hidden). That's
 * why the connection-instructions block further down ALWAYS shows the `TU_TOKEN_AQUI` placeholder,
 * never the real token: the raw token never lives in any state that survives closing the reveal
 * modal, not even in client memory, beyond what's strictly needed to show it once.
 */

const MCP_TOKEN_ACTIVE_LIMIT = 10; // Must match the `enforce_mcp_token_limit` trigger's cap — this
// is only a UX head start (avoids a doomed request); the real enforcement is the DB trigger, same
// approach as `canAddVocabularyTerm`/`atLimit` in vocabulary.

const HEADER_VALUE_PLACEHOLDER = "Bearer TU_TOKEN_AQUI";

/**
 * Copies `text` to the clipboard. Tries the Clipboard API first; if unavailable (non-HTTPS
 * context, old browser) or it fails (permission denied), falls back to a temporary `<textarea>` +
 * `document.execCommand("copy")` (legacy API, still supported in every relevant browser). Never
 * throws — returns `false` if no mechanism worked, so the caller can notify without breaking the
 * UI.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through to the fallback below (e.g. permission denied by the browser).
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const { show: toast } = useToast();
  const [copying, setCopying] = useState(false);

  async function handleCopy() {
    setCopying(true);
    const ok = await copyToClipboard(value);
    toast(ok ? "Copiado." : "No se pudo copiar — seleccioná el texto manualmente.", ok ? "success" : "error");
    setCopying(false);
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleCopy} loading={copying} className="shrink-0">
      {label}
    </Button>
  );
}

export function MCPTokensSection({
  initialTokens,
  mcpEndpointUrl,
}: {
  initialTokens: McpTokenSummary[];
  mcpEndpointUrl: string;
}) {
  const { show: toast } = useToast();
  const [tokens, setTokens] = useState(initialTokens);
  const [createOpen, setCreateOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ label: string; token: string } | null>(null);

  const activeCount = tokens.filter((t) => !t.revoked_at).length;
  const atLimit = activeCount >= MCP_TOKEN_ACTIVE_LIMIT;

  const jsonConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        "audio-transcriber": {
          type: "http",
          url: mcpEndpointUrl,
          headers: { Authorization: HEADER_VALUE_PLACEHOLDER },
        },
      },
    },
    null,
    2
  );

  function openCreateModal() {
    setLabelDraft("");
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (creating) return;
    setCreateOpen(false);
  }

  function closeReveal() {
    setRevealedToken(null); // Clears the raw token from state — it does not survive closing the modal.
  }

  async function submitCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "No se pudo generar el token.", "error");
        return;
      }
      setTokens((prev) => [
        { id: data.id, label: data.label, created_at: data.created_at, last_used_at: null, revoked_at: null },
        ...prev,
      ]);
      setCreateOpen(false);
      setRevealedToken({ label: data.label, token: data.token });
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: McpTokenSummary) {
    setBusyId(token.id);
    try {
      const res = await fetch(`/api/mcp-tokens/${token.id}`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "No se pudo revocar el token.", "error");
        return;
      }
      setTokens((prev) => prev.map((t) => (t.id === token.id ? (data.token as McpTokenSummary) : t)));
      toast("Token revocado.", "success");
    } catch {
      toast("No se pudo contactar al servidor.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background"
          aria-hidden="true"
        >
          <Icon name="mcp" size={18} />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Conexión MCP</h2>
          <p className="text-sm text-tertiary">
            Conectá tus transcripciones a Claude o ChatGPT (vía MCP, un protocolo estándar para que
            las apps de IA lean tus datos) para poder preguntarles sobre tus notas desde ahí.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={openCreateModal} disabled={atLimit}>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="key" />
            Generar token
          </span>
        </Button>
        <p role="status" aria-live="polite" className="mt-1.5 text-xs text-tertiary">
          {atLimit ? `Llegaste al máximo de ${MCP_TOKEN_ACTIVE_LIMIT} tokens activos. Revocá alguno para generar otro.` : ""}
        </p>
      </div>

      {tokens.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{t.label}</p>
                <p className="text-xs text-tertiary">
                  Creado el {formatDate(t.created_at)} · Último uso: {t.last_used_at ? formatDate(t.last_used_at) : "nunca"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {t.revoked_at ? (
                  <Badge tone="neutral">Revocado</Badge>
                ) : (
                  <Button variant="danger-outline" size="sm" loading={busyId === t.id} onClick={() => revoke(t)}>
                    Revocar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">Todavía no generaste ningún token.</p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Cómo conectarlo</h3>
        <p className="mt-1 text-xs text-tertiary">
          En Claude: Configuración → Conectores → &quot;Agregar conector personalizado&quot;. Pegá la URL de
          abajo y, en &quot;Request headers&quot;, agregá un header <code className="rounded bg-surface-secondary px-1 py-0.5">Authorization</code>{" "}
          con el valor de más abajo tal cual está (con &quot;Bearer &quot; adelante).
        </p>

        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs font-semibold text-tertiary">URL del servidor MCP</span>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-secondary">
                {mcpEndpointUrl}
              </code>
              <CopyButton value={mcpEndpointUrl} />
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-tertiary">Header &quot;Authorization&quot;</span>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-secondary">
                {HEADER_VALUE_PLACEHOLDER}
              </code>
              <CopyButton value={HEADER_VALUE_PLACEHOLDER} />
            </div>
            <p className="mt-1 text-xs text-tertiary">Reemplazá TU_TOKEN_AQUI por el token que generes arriba.</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-tertiary">
          La sección &quot;Request headers&quot; está en beta en Claude y se está activando de a poco — si
          todavía no la ves en tu cuenta, puede que tarde un poco en llegarte.
        </p>

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">
            ¿Usás otro cliente MCP (Claude Code, etc.)?
          </summary>
          <div className="mt-2 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-secondary">
              {jsonConfigSnippet}
            </pre>
            <CopyButton value={jsonConfigSnippet} />
          </div>
        </details>
      </div>

      {createOpen && (
        <Modal onClose={closeCreateModal} closeOnBackdrop={!creating} labelledBy="mcp-token-create-title">
          <div className="flex items-center justify-between">
            <h3 id="mcp-token-create-title" className="font-semibold text-foreground">
              Generar token MCP
            </h3>
            <button
              onClick={closeCreateModal}
              disabled={creating}
              className="rounded-md px-2 py-1 text-tertiary transition hover:bg-surface-secondary disabled:opacity-40"
              aria-label="Cerrar"
            >
              <Icon name="close" />
            </button>
          </div>
          <p className="mt-1 text-xs text-tertiary">Ponele un nombre para reconocerlo después (ej. qué app lo va a usar).</p>
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCreate();
              }
            }}
            maxLength={MAX_MCP_TOKEN_LABEL_LENGTH}
            placeholder="Ej: Claude Desktop"
            aria-label="Nombre del token"
            disabled={creating}
            className="mt-3 w-full rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-accent disabled:opacity-60"
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={submitCreate} loading={creating} className="flex-1">
              Generar
            </Button>
            <Button variant="secondary" onClick={closeCreateModal} disabled={creating}>
              Cancelar
            </Button>
          </div>
        </Modal>
      )}

      {revealedToken && (
        <Modal onClose={closeReveal} labelledBy="mcp-token-reveal-title">
          <div className="flex items-center justify-between">
            <h3 id="mcp-token-reveal-title" className="font-semibold text-foreground">
              Token generado
            </h3>
            <button
              onClick={closeReveal}
              className="rounded-md px-2 py-1 text-tertiary transition hover:bg-surface-secondary"
              aria-label="Cerrar"
            >
              <Icon name="close" />
            </button>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200"
          >
            <Icon name="warning" className="shrink-0" />
            <span>Guardá este token ahora — no lo vamos a poder mostrar de nuevo. Si lo perdés, vas a tener que generar uno nuevo.</span>
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-tertiary">Token para &quot;{revealedToken.label}&quot;</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-secondary">
                {revealedToken.token}
              </code>
              <CopyButton value={revealedToken.token} />
            </div>
          </div>

          <Button onClick={closeReveal} className="mt-4 w-full">
            Listo, ya lo guardé
          </Button>
        </Modal>
      )}
    </div>
  );
}
