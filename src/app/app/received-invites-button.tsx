"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icon";

type InvitableRole = "admin" | "editor" | "viewer";
type ReceivedInvite = { id: string; role: InvitableRole; project_name: string | null };

const ROLE_LABEL: Record<InvitableRole, string> = { admin: "administrador/a", editor: "editor/a", viewer: "lector/a" };
const GENERIC_ERROR = "No pudimos procesar la invitación. Probá de nuevo.";

/**
 * Widget del header (`AppLayout`): invitaciones RECIBIDAS por el usuario actual, en algún lugar
 * visible en TODO el dashboard (no solo dentro de un proyecto puntual) — así alguien invitado se
 * entera aunque nunca haya navegado a ese proyecto todavía.
 *
 * `initialCount` viene resuelto en el server (`layout.tsx`, misma sesión que ya se usa para el
 * resto del header) para que el badge aparezca sin esperar un fetch de cliente; el detalle
 * completo (nombre del proyecto, rol) recién se pide al abrir el modal.
 */
export function ReceivedInvitesButton({ initialCount }: { initialCount: number }) {
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [invites, setInvites] = useState<ReceivedInvite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/invites");
      if (!res.ok) throw new Error("load failed");
      const body = await res.json();
      const list = (body.invites ?? []) as ReceivedInvite[];
      setInvites(list);
      setCount(list.length);
    } catch {
      setLoadError("No pudimos cargar tus invitaciones. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  function openModal() {
    setOpen(true);
    load();
  }

  async function respond(inviteId: string, action: "accept" | "reject") {
    setBusyId(inviteId);
    try {
      const res = await fetch(`/api/invites/${inviteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? GENERIC_ERROR, "error");
        return;
      }
      if (action === "accept") {
        // El proyecto nuevo tiene que aparecer en el sidebar y en todos lados: una recarga
        // completa es más simple y confiable acá que sincronizar manualmente cada lista del
        // dashboard (sidebar de proyectos, conteos, etc.) contra un fetch cliente.
        toast("¡Listo! Ya tenés acceso al proyecto.", "success");
        window.location.reload();
        return;
      }
      toast("Invitación rechazada.", "success");
      await load();
    } catch {
      toast(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="Invitaciones recibidas"
        className="relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:bg-surface-secondary hover:text-accent"
      >
        <Icon name="share" className="shrink-0" />
        <span className="hidden sm:inline">Invitaciones</span>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white"
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="received-invites-title">
          <h2 id="received-invites-title" className="text-lg font-semibold text-foreground">
            Invitaciones recibidas
          </h2>
          {loading && invites === null ? (
            <div className="mt-6 flex justify-center py-4">
              <Spinner />
            </div>
          ) : loadError ? (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : invites && invites.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {invites.map((inv) => (
                <li key={inv.id} className="rounded-lg border border-border px-3 py-2.5 text-sm">
                  <p className="font-medium text-foreground">{inv.project_name ?? "Un proyecto"}</p>
                  <p className="text-xs text-tertiary">Te invitaron como {ROLE_LABEL[inv.role]}.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" loading={busyId === inv.id} onClick={() => respond(inv.id, "accept")}>
                      Aceptar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busyId === inv.id}
                      onClick={() => respond(inv.id, "reject")}
                    >
                      Rechazar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-tertiary">No tenés invitaciones pendientes.</p>
          )}
        </Modal>
      )}
    </>
  );
}
