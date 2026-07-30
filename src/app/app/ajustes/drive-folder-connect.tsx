"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icon";
import { canConnectFolderLevel, validateNewFolderName } from "@/lib/drive/folder-connect";
import { parseDriveFolderId } from "@/lib/drive/folder-link";

type DriveFolder = { id: string; name: string };
type Crumb = { id: string; name: string };

const ROOT_CRUMB: Crumb = { id: "root", name: "Mi unidad" };

type ImportSummary = {
  // `audios` es opcional: durante la ventana de rollout de la migración que agrega
  // `drive_audio_file_id` el servidor puede no devolverlo todavía.
  imported: { projects: number; transcriptions: number; audios?: number };
  skipped: { existingFolders: number; existingFiles: number; otherFiles: number };
  depthTruncated: boolean;
};

/**
 * Modal "Conectar carpeta de Drive" (doc 10): árbol navegable server-side (sin Google Picker —
 * el token del browser tiene scope `drive.file`, insuficiente para recorrer carpetas ajenas). Se
 * apoya en `GET /api/drive/folders` para listar subcarpetas y en `POST
 * /api/drive/folders/connect` para conectar + importar recursivamente la carpeta actual.
 */
export function DriveFolderConnect() {
  const router = useRouter();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT_CRUMB]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  // Pegar el link de una carpeta. Es el ÚNICO camino a una carpeta COMPARTIDA con el usuario: el
  // árbol de abajo desciende desde `root` ("Mi unidad") y lo compartido no es hijo de root, así que
  // navegando nunca aparece.
  const [linkInput, setLinkInput] = useState("");
  const [resolvingLink, setResolvingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const current = crumbs[crumbs.length - 1];
  const canConnect = canConnectFolderLevel(current.id);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // Función nombrada (no un setState directo en el cuerpo del efecto): el fetch dispara sus
    // propios cambios de estado dentro del handler async, evitando la cascada de renders que
    // marca `react-hooks/set-state-in-effect` ante un `setState` síncrono a nivel del efecto.
    async function loadFolders() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/drive/folders?parent=${encodeURIComponent(current.id)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "No se pudieron listar las carpetas.");
        if (!cancelled) setFolders(body.folders as DriveFolder[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron listar las carpetas.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFolders();
    return () => {
      cancelled = true;
    };
  }, [open, current.id]);

  function openModal() {
    setCrumbs([ROOT_CRUMB]);
    setFolders([]);
    setError(null);
    setSummary(null);
    setOpen(true);
  }

  function closeModal() {
    if (connecting) return; // no cerrar en medio de una importación
    setOpen(false);
  }

  // Al navegar a otro nivel se descarta el formulario de "crear carpeta" abierto en el nivel
  // anterior (evento explícito del usuario, no un efecto derivado — evita el
  // `react-hooks/set-state-in-effect` que ya se sortea en `loadFolders` de otra forma).
  function resetCreateForm() {
    setShowCreateForm(false);
    setNewFolderName("");
    setCreateFolderError(null);
  }

  function enterFolder(folder: DriveFolder) {
    resetCreateForm();
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  /**
   * Resuelve el link pegado y entra a esa carpeta, dejándola lista para conectar con el mismo botón
   * de siempre. NO conecta sola: el usuario ve el nombre real que devolvió Drive antes de importar
   * nada — pegar un link equivocado e importar un árbol ajeno sin confirmación sería una sorpresa
   * cara en un flujo que ya es cuidadoso justamente con eso (ver `canConnectFolderLevel` y la raíz).
   *
   * El breadcrumb se REEMPLAZA en vez de apilarse: la carpeta pegada no cuelga de donde estabas
   * navegando (puede estar en otra cuenta o en "Compartido conmigo"), así que mostrar
   * "Mi unidad / … / Pegada" sería una jerarquía inventada.
   */
  async function submitLink() {
    const folderId = parseDriveFolderId(linkInput);
    if (!folderId) {
      setLinkError("Ese no parece un link de carpeta de Drive. Copiá el link desde Drive con “Compartir → Copiar vínculo”.");
      return;
    }

    setResolvingLink(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/drive/folders?id=${encodeURIComponent(folderId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo abrir esa carpeta.");

      const folder = body.folder as DriveFolder;
      resetCreateForm();
      setLinkInput("");
      setError(null);
      setCrumbs([ROOT_CRUMB, { id: folder.id, name: folder.name }]);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "No se pudo abrir esa carpeta.");
    } finally {
      setResolvingLink(false);
    }
  }

  function goToCrumb(index: number) {
    resetCreateForm();
    setCrumbs((prev) => prev.slice(0, index + 1));
  }

  async function connectCurrent() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/drive/folders/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFolderId: current.id, name: current.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo conectar la carpeta.");
      setSummary(body as ImportSummary);
      toast("Carpeta de Drive conectada.", "success");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo conectar la carpeta.";
      setError(message);
      toast(message, "error");
    } finally {
      setConnecting(false);
    }
  }

  function toggleCreateForm() {
    setShowCreateForm((v) => !v);
    setNewFolderName("");
    setCreateFolderError(null);
  }

  async function submitCreateFolder() {
    const parsed = validateNewFolderName(newFolderName);
    if (!parsed.ok) {
      setCreateFolderError(parsed.error);
      return;
    }
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      const res = await fetch("/api/drive/folders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: current.id, name: parsed.value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo crear la carpeta.");
      const created: DriveFolder = { id: body.id as string, name: body.name as string };
      setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "es")));
      setShowCreateForm(false);
      setNewFolderName("");
      toast(`Carpeta "${created.name}" creada.`, "success");
    } catch (err) {
      setCreateFolderError(err instanceof Error ? err.message : "No se pudo crear la carpeta.");
    } finally {
      setCreatingFolder(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={openModal}>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="folder-open" />
          Conectar carpeta de Drive
        </span>
      </Button>
    );
  }

  return (
    <Modal onClose={closeModal} closeOnBackdrop={!connecting} labelledBy="drive-connect-title">
      <div className="flex items-center justify-between">
        <h3 id="drive-connect-title" className="font-semibold text-foreground">
          Conectar carpeta de Drive
        </h3>
        <button
          onClick={closeModal}
          disabled={connecting}
          className="rounded-md px-2 py-1 text-tertiary transition hover:bg-surface-secondary disabled:opacity-40"
          aria-label="Cerrar"
        >
          <Icon name="close" />
        </button>
      </div>

      {!summary && (
        <p className="mt-1 text-xs text-tertiary">
          Entrá a una carpeta puntual de Drive (o creá una nueva) y conectala: se importa esa carpeta junto con
          toda su jerarquía de subcarpetas y notas .md.
        </p>
      )}

      {/* Pegar el link. Va ARRIBA del árbol y no escondido detrás de un "avanzado": para una carpeta
          que te compartieron es el único camino, porque el árbol de abajo solo baja por "Mi unidad". */}
      {!summary && (
        <div className="mt-3 rounded-lg border border-border bg-background p-2.5">
          <label htmlFor="drive-folder-link" className="text-xs font-medium text-secondary">
            Pegá el link de la carpeta
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="drive-folder-link"
              value={linkInput}
              onChange={(e) => {
                setLinkInput(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitLink();
              }}
              disabled={resolvingLink || connecting}
              placeholder="https://drive.google.com/drive/folders/…"
              className="min-w-0 flex-1 rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={submitLink}
              loading={resolvingLink}
              disabled={!linkInput.trim() || connecting}
            >
              Abrir
            </Button>
          </div>
          {linkError ? (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{linkError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-tertiary">
              Es la única forma de conectar una carpeta que te compartieron: esas no aparecen en la lista de acá
              abajo, que solo recorre tu propia unidad.
            </p>
          )}
        </div>
      )}

      {summary ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
            <Icon name="success" className="shrink-0" /> Carpeta conectada
          </p>
          <ul className="space-y-1 text-secondary">
            <li>
              {summary.imported.projects} subcarpeta(s) y {summary.imported.transcriptions} nota(s) importadas.
            </li>
            {!!summary.imported.audios && summary.imported.audios > 0 && (
              <li>
                {summary.imported.audios} audio(s) importados, listos para transcribir desde la pantalla principal.
              </li>
            )}
            {(summary.skipped.existingFolders > 0 || summary.skipped.existingFiles > 0) && (
              <li className="text-tertiary">
                {summary.skipped.existingFolders} carpeta(s) y {summary.skipped.existingFiles} nota(s) ya estaban
                importadas — no se duplicaron.
              </li>
            )}
            {summary.skipped.otherFiles > 0 && (
              <li className="text-tertiary">
                {summary.skipped.otherFiles} archivo(s) que no son carpeta ni .md se ignoraron.
              </li>
            )}
            {summary.depthTruncated && (
              <li className="text-amber-600">
                La carpeta tenía más de 20 niveles de profundidad; lo que está más abajo no se importó.
              </li>
            )}
          </ul>
          <Button onClick={closeModal} className="mt-2 w-full">
            Listo
          </Button>
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          <nav className="mt-3 flex flex-wrap items-center gap-1 text-xs text-tertiary" aria-label="Ubicación en Drive">
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-tertiary" aria-hidden="true">
                    /
                  </span>
                )}
                <button
                  onClick={() => goToCrumb(i)}
                  disabled={i === crumbs.length - 1 || connecting}
                  className={i === crumbs.length - 1 ? "font-semibold text-secondary" : "hover:underline"}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-2 max-h-64 min-h-[6rem] overflow-y-auto rounded-lg border border-border">
            {loading ? (
              <p className="flex items-center justify-center gap-2 p-4 text-sm text-tertiary">
                <Spinner size="xs" /> Cargando…
              </p>
            ) : folders.length === 0 ? (
              <p className="p-4 text-center text-sm text-tertiary">Sin subcarpetas acá.</p>
            ) : (
              <ul className="divide-y divide-border">
                {folders.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => enterFolder(f)}
                      disabled={connecting}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-secondary transition hover:bg-background disabled:opacity-50"
                    >
                      <Icon name="folder" className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-tertiary" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Crear carpeta nueva en el nivel actual */}
          <div className="mt-2">
            {showCreateForm ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCreateFolder();
                    if (e.key === "Escape") toggleCreateForm();
                  }}
                  disabled={creatingFolder}
                  placeholder="Nombre de la carpeta"
                  aria-label="Nombre de la carpeta nueva"
                  className="min-w-0 flex-1 rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary focus:border-accent focus:outline-none disabled:opacity-50"
                />
                <Button size="sm" onClick={submitCreateFolder} loading={creatingFolder}>
                  Crear
                </Button>
                <Button size="sm" variant="secondary" onClick={toggleCreateForm} disabled={creatingFolder}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <button
                onClick={toggleCreateForm}
                disabled={connecting || loading}
                className="text-xs font-medium text-accent transition hover:underline disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="folder-plus" />
                  Crear carpeta nueva acá
                </span>
              </button>
            )}
            {createFolderError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{createFolderError}</p>}
          </div>

          {canConnect ? (
            <p className="mt-2 text-xs text-tertiary">
              Se importa &quot;{current.name}&quot; con toda su jerarquía de subcarpetas y notas .md.
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-600">
              Entrá a una carpeta o creá una nueva para conectarla — conectar acá importaría TODO tu Drive.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              onClick={connectCurrent}
              loading={connecting}
              disabled={loading || !canConnect}
              className="flex-1"
            >
              {connecting ? "Importando… puede tardar" : canConnect ? `Conectar "${current.name}"` : "Entrá a una carpeta"}
            </Button>
            <Button variant="secondary" onClick={closeModal} disabled={connecting}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
