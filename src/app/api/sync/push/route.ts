import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiUser } from "@/lib/supabase/api";
import { validateProjectName } from "@/lib/format";
import { collectProjectSubtreeIds, wouldCreateProjectCycle, type ProjectParentLink } from "@/lib/drive/tree";
import {
  buildProjectRow,
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markSchemaCompatResult,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";

export const runtime = "nodejs";

/**
 * Columnas de Drive-sync v2 (doc 10): agregadas por la migración
 * `20260707130000_drive_sync_v2_foundation.sql`, que en producción se corre A MANO — el código
 * puede quedar desplegado antes de que existan en el esquema real. Ver
 * `src/lib/supabase/schema-compat.ts` para el patrón expand/contract (detección por intento
 * real + cache con TTL, compartido con /api/sync/pull).
 *
 * Trae `id, parent_project_id` de los proyectos ACTIVOS del usuario, con fallback automático a
 * `id` solo si la columna todavía no existe. Sin la columna, no hay jerarquía que validar: se
 * devuelve la lista de ids con `parentProjectId: null` para todos (mismo comportamiento que
 * tenía el código ANTES de Drive-sync v2).
 */
async function fetchActiveProjectParentLinksCompat(
  supabase: SupabaseClient,
  userId: string
): Promise<{ links: ProjectParentLink[]; columnsAvailable: boolean; error: { message: string } | null }> {
  const now = Date.now();
  const runQuery = (columns: string) =>
    supabase.from("projects").select(columns).eq("user_id", userId).is("deleted_at", null);

  const cached = getSchemaCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectSchemaCompat(now);

  if (useReducedDirectly) {
    const { data, error } = await runQuery("id");
    const links = ((data ?? []) as unknown as { id: string }[]).map((p) => ({ id: p.id, parentProjectId: null }));
    return { links, columnsAvailable: false, error };
  }

  const { data, error } = await runQuery("id, parent_project_id");
  if (!error) {
    markSchemaCompatResult(true, now);
    const links = ((data ?? []) as unknown as { id: string; parent_project_id: string | null }[]).map((p) => ({
      id: p.id,
      parentProjectId: p.parent_project_id,
    }));
    return { links, columnsAvailable: true, error: null };
  }

  if (isMissingColumnError(error)) {
    markSchemaCompatResult(false, now);
    const retry = await runQuery("id");
    const links = ((retry.data ?? []) as unknown as { id: string }[]).map((p) => ({ id: p.id, parentProjectId: null }));
    return { links, columnsAvailable: false, error: retry.error };
  }

  return { links: [], columnsAvailable: cached.available ?? true, error };
}

/**
 * Sync push: el cliente desktop envía cambios de metadata.
 * - Proyectos: crear/renombrar (upsert, jerarquía opcional) y borrar (soft, en cascada al subárbol).
 * - Transcripciones: editar título/texto/proyecto y borrar (soft).
 *   La CREACIÓN de transcripciones (con audio) va por /api/transcribe, no acá.
 *
 * El cliente es autoritativo sobre los IDs: genera UUIDs para los proyectos nuevos
 * y los manda como `id`, así la correlación local↔remoto es directa.
 *
 * Body:
 * {
 *   projects?:       { upserts?: [{ id, name, icon?, description?, parent_project_id? }], deletes?: string[] },
 *   transcriptions?: { upserts?: [{ id, title?, text?, description?, icon?, project_id? }], deletes?: string[] }
 * }
 *
 * Jerarquía (Drive-sync v2, doc 10): `parent_project_id` es OPCIONAL en cada upsert.
 * - Si no viene el campo (`undefined`): el proyecto se crea/actualiza sin tocar su padre actual
 *   (raíz en creación; sin cambios en edición) — comportamiento previo intacto.
 * - Si viene `null`: el proyecto pasa a ser raíz (se desengancha de su padre).
 * - Si viene un id: se valida que sea un proyecto ACTIVO del mismo usuario y que asignarlo no
 *   genere un ciclo (`wouldCreateProjectCycle`, en `src/lib/drive/tree.ts`); si falla cualquiera
 *   de las dos validaciones, ese ítem se reporta en `errors` y NO se toca su padre (el resto del
 *   push sigue). Contrato para el cliente: mandar los upserts en orden padre-primero dentro del
 *   mismo push si crea jerarquía nueva de punta a punta (un hijo no puede referenciar como padre
 *   a un proyecto que todavía no existe en la base).
 *
 * Borrado en cascada: borrar un proyecto (`projects.deletes`) propaga `deleted_at` a TODO su
 * subárbol (hijos, nietos, ...) y a las transcripciones de cada uno de esos proyectos — ya no
 * quedan huérfanos promovidos a raíz ni transcripciones "sueltas" a mitad de camino. Ver
 * `collectProjectSubtreeIds` en `src/lib/drive/tree.ts` (única fuente de verdad, también usada
 * por la papelera del server action `deleteProject`).
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getApiUser(req);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    let body: PushBody;
    try {
      body = (await req.json()) as PushBody;
    } catch {
      return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const errors: string[] = [];

    // ---- Proyectos: upserts ----
    if ((body.projects?.upserts ?? []).length > 0) {
      // Snapshot de la jerarquía ACTIVA del usuario para validar ownership + anti-ciclo de
      // `parent_project_id`. Se actualiza en memoria a medida que se procesan upserts exitosos,
      // para soportar jerarquía nueva de punta a punta dentro del mismo push (padres antes que
      // hijos, ver contrato documentado arriba).
      //
      // Compatibilidad de esquema (Drive-sync v2, ver src/lib/supabase/schema-compat.ts): si la
      // columna `parent_project_id` todavía no existe en producción (migración no corrida a
      // mano todavía), `columnsAvailable` viene en `false` y TODA la jerarquía se ignora —
      // comportamiento idéntico al de antes de Drive-sync v2, sin romper el resto del push.
      const {
        links: parentLinks,
        columnsAvailable,
        error: existingErr,
      } = await fetchActiveProjectParentLinksCompat(supabase, user.id);
      if (existingErr) {
        errors.push(`No se pudo validar la jerarquía de proyectos: ${existingErr.message}`);
      }
      const parentById = new Map(parentLinks.map((p) => [p.id, p] as const));

      for (const p of body.projects?.upserts ?? []) {
        try {
          const parsed = validateProjectName(p.name ?? "");
          if (!p.id || !parsed.ok) {
            errors.push(`Proyecto inválido: ${p.id ?? "(sin id)"}`);
            continue;
          }

          const baseRow = {
            id: p.id,
            user_id: user.id,
            name: parsed.value,
            title: parsed.value,
            icon: (p.icon ?? "").slice(0, 8),
            description: p.description ?? "",
            deleted_at: null,
          };

          let resolvedParentId: string | null | undefined; // undefined = no se pudo resolver (error)
          let parentProjectIdForRow: string | null | undefined; // undefined = no incluir la clave

          if (!columnsAvailable) {
            // Columna no disponible todavía: se ignora cualquier `parent_project_id` que haya
            // mandado el cliente (no se valida ni se reporta como error) y no se incluye esa
            // clave en el insert — comportamiento idéntico al de antes de Drive-sync v2.
            resolvedParentId = undefined;
            parentProjectIdForRow = undefined;
          } else if (p.parent_project_id === undefined) {
            resolvedParentId = undefined; // no tocar el campo
            parentProjectIdForRow = undefined;
          } else if (p.parent_project_id === null) {
            resolvedParentId = null;
            parentProjectIdForRow = null;
          } else {
            const parentId = p.parent_project_id;
            if (!parentById.has(parentId)) {
              errors.push(`Proyecto ${p.id}: parent_project_id "${parentId}" no existe o no es tuyo.`);
            } else if (wouldCreateProjectCycle(p.id, parentId, parentLinks)) {
              errors.push(`Proyecto ${p.id}: parent_project_id "${parentId}" generaría un ciclo.`);
            } else {
              resolvedParentId = parentId;
              parentProjectIdForRow = parentId;
            }
          }

          const insert = buildProjectRow(baseRow, { parent_project_id: parentProjectIdForRow }, columnsAvailable);

          const { error } = await supabase.from("projects").upsert(insert);
          if (error) {
            errors.push(`Proyecto ${p.id}: ${error.message}`);
            continue;
          }

          // Reflejamos el resultado en el snapshot en memoria para próximos ítems del mismo push.
          if (resolvedParentId !== undefined) {
            const existing = parentById.get(p.id);
            if (existing) existing.parentProjectId = resolvedParentId;
            else {
              const link: ProjectParentLink = { id: p.id, parentProjectId: resolvedParentId };
              parentLinks.push(link);
              parentById.set(p.id, link);
            }
          } else if (!parentById.has(p.id)) {
            const link: ProjectParentLink = { id: p.id, parentProjectId: null };
            parentLinks.push(link);
            parentById.set(p.id, link);
          }
        } catch (err) {
          // Un item inválido (ej. id que no es UUID válido) no debe tumbar el resto del push.
          errors.push(`Proyecto ${p.id ?? "(sin id)"}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ---- Proyectos: deletes (soft, en cascada al subárbol completo) ----
    for (const id of body.projects?.deletes ?? []) {
      try {
        // Compatibilidad de esquema: sin `parent_project_id` disponible no hay subárbol que
        // calcular (todos los proyectos son "raíz" a los efectos del borrado) — el borrado
        // sigue funcionando, solo que acotado al propio proyecto (comportamiento previo a
        // Drive-sync v2), en vez de fallar por completo.
        const { links: activeLinks, error: fetchErr } = await fetchActiveProjectParentLinksCompat(supabase, user.id);
        if (fetchErr) {
          errors.push(`Borrar proyecto ${id}: ${fetchErr.message}`);
          continue;
        }

        const subtreeIds = Array.from(collectProjectSubtreeIds(id, activeLinks));

        const { error: tError } = await supabase
          .from("transcriptions")
          .update({ deleted_at: now })
          .in("project_id", subtreeIds)
          .eq("user_id", user.id);
        if (tError) errors.push(`Borrar transcripciones del proyecto ${id}: ${tError.message}`);

        const { error } = await supabase
          .from("projects")
          .update({ deleted_at: now })
          .in("id", subtreeIds)
          .eq("user_id", user.id);
        if (error) errors.push(`Borrar proyecto ${id}: ${error.message}`);
      } catch (err) {
        errors.push(`Borrar proyecto ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ---- Transcripciones: upserts (solo metadata/texto, no creación) ----
    for (const t of body.transcriptions?.upserts ?? []) {
      try {
        if (!t.id) {
          errors.push("Transcripción sin id");
          continue;
        }
        const update: Record<string, unknown> = {};
        if (t.title !== undefined) update.title = (t.title ?? "").slice(0, 120);
        if (t.text !== undefined) update.text = t.text;
        if (t.description !== undefined) update.description = (t.description ?? "").slice(0, 2000);
        if (t.icon !== undefined) update.icon = (t.icon ?? "").slice(0, 8);
        if (t.project_id !== undefined) update.project_id = t.project_id;
        if (Object.keys(update).length === 0) continue;

        const { error } = await supabase
          .from("transcriptions")
          .update(update)
          .eq("id", t.id)
          .eq("user_id", user.id);
        if (error) errors.push(`Transcripción ${t.id}: ${error.message}`);
      } catch (err) {
        errors.push(`Transcripción ${t.id ?? "(sin id)"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ---- Transcripciones: deletes (soft) ----
    for (const id of body.transcriptions?.deletes ?? []) {
      try {
        const { error } = await supabase
          .from("transcriptions")
          .update({ deleted_at: now })
          .eq("id", id)
          .eq("user_id", user.id);
        if (error) errors.push(`Borrar transcripción ${id}: ${error.message}`);
      } catch (err) {
        errors.push(`Borrar transcripción ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      serverTime: now,
      ok: errors.length === 0,
      errors,
    });
  } catch (err) {
    // Red de seguridad: cualquier excepción no prevista (ej. throw fuera del manejo
    // por-ítem) devuelve un 500 con mensaje real en vez de un cuerpo vacío opaco.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

type PushBody = {
  projects?: {
    upserts?: {
      id: string;
      name: string;
      icon?: string;
      description?: string;
      /** Ver contrato de jerarquía en el comentario de cabecera del archivo. */
      parent_project_id?: string | null;
    }[];
    deletes?: string[];
  };
  transcriptions?: {
    upserts?: {
      id: string;
      title?: string;
      text?: string;
      description?: string;
      icon?: string;
      project_id?: string | null;
    }[];
    deletes?: string[];
  };
};
