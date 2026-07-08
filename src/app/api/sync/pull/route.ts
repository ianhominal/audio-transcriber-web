import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiUser } from "@/lib/supabase/api";
import { AUDIO_BUCKET } from "@/lib/storage";
import {
  getSchemaCompatSnapshot,
  isMissingColumnError,
  markSchemaCompatResult,
  shouldRedetectSchemaCompat,
} from "@/lib/supabase/schema-compat";

export const runtime = "nodejs";

// Columnas de Drive-sync v2 (doc 10): agregadas por la migración
// `20260707130000_drive_sync_v2_foundation.sql`, que en producción se corre A MANO — el código
// puede quedar desplegado antes de que existan. Ver `src/lib/supabase/schema-compat.ts` para el
// patrón expand/contract completo (detección por intento real + cache con TTL).
const PROJECT_COLUMNS_FULL =
  "id, name, icon, description, parent_project_id, sync_origin, created_at, updated_at, deleted_at";
const PROJECT_COLUMNS_REDUCED = "id, name, icon, description, created_at, updated_at, deleted_at";

type ProjectRow = {
  id: string;
  name: string;
  icon: string;
  description: string;
  parent_project_id?: string | null;
  sync_origin?: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Completa `parent_project_id`/`sync_origin` con sus valores por defecto cuando la consulta se
 * ejecutó en modo reducido (columnas no disponibles) — mismo comportamiento que un cliente
 * desktop viejo vería con un proyecto "de toda la vida". */
function withDefaultDriveSyncFields(rows: ProjectRow[]): Required<ProjectRow>[] {
  return rows.map((p) => ({
    ...p,
    parent_project_id: p.parent_project_id ?? null,
    sync_origin: p.sync_origin ?? "local",
  })) as Required<ProjectRow>[];
}

async function fetchProjectsCompat(supabase: SupabaseClient, userId: string, since: string | null) {
  const now = Date.now();
  const runQuery = (columns: string) => {
    let q = supabase.from("projects").select(columns).eq("user_id", userId);
    if (since) q = q.gt("updated_at", since);
    return q;
  };

  const cached = getSchemaCompatSnapshot();
  const useReducedDirectly = cached.available === false && !shouldRedetectSchemaCompat(now);

  if (useReducedDirectly) {
    const { data, error } = await runQuery(PROJECT_COLUMNS_REDUCED);
    return { data: error ? null : withDefaultDriveSyncFields((data ?? []) as unknown as ProjectRow[]), error };
  }

  const { data, error } = await runQuery(PROJECT_COLUMNS_FULL);
  if (!error) {
    markSchemaCompatResult(true, now);
    return { data: (data ?? []) as unknown as ProjectRow[], error: null };
  }

  if (isMissingColumnError(error)) {
    markSchemaCompatResult(false, now);
    const retry = await runQuery(PROJECT_COLUMNS_REDUCED);
    return {
      data: retry.error ? null : withDefaultDriveSyncFields((retry.data ?? []) as unknown as ProjectRow[]),
      error: retry.error,
    };
  }

  return { data: null, error };
}

/**
 * Sync pull: devuelve proyectos y transcripciones del usuario cambiados desde `since`
 * (timestamp ISO). Incluye los borrados (deleted_at != null) como "tombstones", para que
 * el cliente propague borrados/renombres. Sin `since` = pull completo.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await getApiUser(req);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const since = req.nextUrl.searchParams.get("since");
    const serverTime = new Date().toISOString();

    let transcriptionsQuery = supabase
      .from("transcriptions")
      .select(
        "id, project_id, title, audio_name, audio_size, audio_url, text, description, icon, language, model, created_at, updated_at, deleted_at"
      )
      .eq("user_id", user.id);

    if (since) {
      transcriptionsQuery = transcriptionsQuery.gt("updated_at", since);
    }

    const [{ data: projects, error: pErr }, { data: transcriptions, error: tErr }] = await Promise.all([
      fetchProjectsCompat(supabase, user.id, since),
      transcriptionsQuery,
    ]);

    if (pErr || tErr) {
      return NextResponse.json({ error: "No se pudo leer los cambios." }, { status: 500 });
    }

    // Signed URL temporal por cada audio, para que el cliente desktop pueda descargarlo
    // (el bucket es privado). Se generan en paralelo para no bloquear en serie.
    const transcriptionsWithAudio = await Promise.all(
      (transcriptions ?? []).map(async (t) => {
        if (!t.audio_url) return { ...t, audio_url_signed: null };
        const { data: signed, error: signError } = await supabase.storage
          .from(AUDIO_BUCKET)
          .createSignedUrl(t.audio_url, 60 * 60);
        if (signError) {
          // Visibility only: on failure we still return audio_url_signed: null, same as
          // before — this does not change behavior, it just stops the failure from being
          // silent (see .claude/resources/changelog for the cross-repo motivation).
          console.error("[sync/pull] createSignedUrl failed", {
            transcriptionId: t.id,
            audioUrl: t.audio_url,
            error: signError.message,
            name: signError.name,
          });
          Sentry.captureException(signError, {
            extra: { transcriptionId: t.id, audioUrl: t.audio_url, stage: "sync-pull-signed-url" },
          });
        }
        return { ...t, audio_url_signed: signed?.signedUrl ?? null };
      })
    );

    return NextResponse.json({
      serverTime,
      projects: projects ?? [],
      transcriptions: transcriptionsWithAudio,
    });
  } catch (err) {
    // Red de seguridad: cualquier excepción no prevista devuelve un 500 con mensaje
    // real en vez de un cuerpo vacío opaco.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
