import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isMissingTableError } from "@/lib/supabase/schema-compat";

export type ProjectMember = {
  project_id: string;
  user_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  granted_by: string | null;
  created_at: string;
};

/**
 * Team Sharing slice 1b, Phase 9.1. Lists a project's members via the CALLER's RLS-scoped
 * client — the `project_members: read` policy (migration `20260728150000_permission_kernel.sql`)
 * already requires `has_project_access(project_id, auth.uid(), 'read')`, so this is lecture-only:
 * no explicit capability re-check here (I-8, "lecturas: solo RLS, una sola fuente"). Degrades to
 * `[]` instead of a 500 while Phase 2/3's migrations are not applied to production yet.
 */
export async function listProjectMembers(supabase: SupabaseClient, projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, user_id, role, granted_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    console.error("[members] listProjectMembers failed", { projectId, error: error.message });
    Sentry.captureException(error, { extra: { projectId, stage: "list-project-members" } });
    return [];
  }
  return (data ?? []) as ProjectMember[];
}
