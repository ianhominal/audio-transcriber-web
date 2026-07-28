"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icon";

type MemberRole = "owner" | "admin" | "editor" | "viewer";
type InvitableRole = "admin" | "editor" | "viewer";

type Member = { user_id: string; role: MemberRole; email: string | null };
type SentInvite = { id: string; role: InvitableRole; invitee_email: string | null };

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Lector",
};
const INVITABLE_ROLES: InvitableRole[] = ["viewer", "editor", "admin"];
const GENERIC_ERROR = "Algo salió mal. Probá de nuevo en un momento.";

/**
 * Botón "Compartir" de la vista de proyecto: abre un modal con invitar por email + rol, la lista
 * de miembros (cambiar rol / quitar) y las invitaciones pendientes enviadas (cancelar).
 *
 * Cero lógica de permisos acá: los `<select>`/botones se ocultan solo por comodidad (el dueño no
 * tiene controles, por ejemplo), pero quien realmente rechaza un cambio inválido es el servidor
 * (`PATCH`/`DELETE /api/projects/[id]/members/[userId]`) — un 403 con mensaje humano siempre se
 * muestra igual, nunca se asume que el cliente ya filtró todo.
 */
export function ShareProjectButton({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [sentInvites, setSentInvites] = useState<SentInvite[] | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/members`),
        fetch(`/api/invites?projectId=${projectId}`),
      ]);
      if (!membersRes.ok || !invitesRes.ok) throw new Error("load failed");
      const membersBody = await membersRes.json();
      const invitesBody = await invitesRes.json();
      setMembers(membersBody.members ?? []);
      setSentInvites(invitesBody.invites ?? []);
    } catch {
      setLoadError("No pudimos cargar quién tiene acceso a este proyecto. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  function openModal() {
    setOpen(true);
    load();
  }

  function close() {
    setOpen(false);
    setEmail("");
    setInviteError(null);
  }

  async function submitInvite() {
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body.error ?? GENERIC_ERROR);
        return;
      }
      setEmail("");
      toast("Invitación enviada.", "success");
      await load();
    } catch {
      setInviteError(GENERIC_ERROR);
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, newRole: InvitableRole) {
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? GENERIC_ERROR, "error");
        return;
      }
      toast("Rol actualizado.", "success");
      await load();
    } catch {
      toast(GENERIC_ERROR, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? GENERIC_ERROR, "error");
        return;
      }
      toast("Se quitó a esa persona del proyecto.", "success");
      await load();
    } catch {
      toast(GENERIC_ERROR, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function cancelInvite(inviteId: string) {
    setBusyInviteId(inviteId);
    try {
      const res = await fetch(`/api/invites/${inviteId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? GENERIC_ERROR, "error");
        return;
      }
      toast("Invitación cancelada.", "success");
      await load();
    } catch {
      toast(GENERIC_ERROR, "error");
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal}>
        <Icon name="share" /> Compartir
      </Button>
      {open && (
        <Modal onClose={close} labelledBy="share-project-title">
          <h2 id="share-project-title" className="text-lg font-semibold text-foreground">
            Compartir proyecto
          </h2>

          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">Invitar a alguien</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email) submitInvite();
                }}
                placeholder="email@ejemplo.com"
                aria-label="Email de la persona a invitar"
                className="min-w-0 flex-1 rounded-md border border-border-strong px-2.5 py-1.5 text-sm focus:border-accent"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableRole)}
                aria-label="Rol a asignar"
                className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-foreground"
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={submitInvite} loading={inviting} disabled={!email}>
                Invitar
              </Button>
            </div>
            {inviteError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{inviteError}</p>}
          </div>

          {loading && members === null ? (
            <div className="mt-6 flex justify-center py-4">
              <Spinner />
            </div>
          ) : loadError ? (
            <p className="mt-5 text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : (
            <>
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">Miembros</p>
                {members && members.length > 0 ? (
                  <ul className="space-y-2">
                    {members.map((m) => (
                      <li
                        key={m.user_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {m.email ?? "Persona sin datos visibles"}
                          {m.user_id === currentUserId && <span className="text-tertiary"> (vos)</span>}
                        </span>
                        {m.role === "owner" ? (
                          <Badge tone="brand">Dueño</Badge>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <select
                              value={m.role}
                              disabled={busyUserId === m.user_id}
                              onChange={(e) => changeRole(m.user_id, e.target.value as InvitableRole)}
                              aria-label={`Rol de ${m.email ?? "esta persona"}`}
                              className="rounded-md border border-border-strong bg-surface px-1.5 py-1 text-xs text-foreground disabled:opacity-50"
                            >
                              {INVITABLE_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABEL[r]}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="danger-outline"
                              size="sm"
                              loading={busyUserId === m.user_id}
                              onClick={() => removeMember(m.user_id)}
                            >
                              Quitar
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-tertiary">Todavía sos la única persona con acceso a este proyecto.</p>
                )}
              </div>

              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">Invitaciones pendientes</p>
                {sentInvites && sentInvites.length > 0 ? (
                  <ul className="space-y-2">
                    {sentInvites.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{inv.invitee_email ?? "Invitación pendiente"}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone="warning">{ROLE_LABEL[inv.role]}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyInviteId === inv.id}
                            onClick={() => cancelInvite(inv.id)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-tertiary">No hay invitaciones pendientes.</p>
                )}
              </div>
            </>
          )}

          <div className="mt-5 flex justify-end">
            <Button variant="secondary" size="sm" onClick={close}>
              Cerrar
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
