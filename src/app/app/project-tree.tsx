"use client";

import { useState } from "react";
import { ProjectRow } from "./project-row";
import { buildProjectTree, type ProjectTreeInput, type ProjectTreeNode } from "@/lib/drive/tree";

/**
 * Renderiza el sidebar de proyectos como árbol (doc 10): los proyectos locales (sin
 * `parent_project_id`, `sync_origin='local'`) siguen viéndose planos, exactamente igual que
 * antes; los de Drive con subcarpetas importadas se anidan e indentan, con chevron para
 * colapsar/expandir. `buildProjectTree` es PURO (`src/lib/drive/tree.ts`) — este componente solo
 * agrega el estado de expandido/colapsado (client-side, no persiste entre reloads a propósito).
 */
export function ProjectTree({
  projects,
  counts,
  activeProjectId,
}: {
  projects: ProjectTreeInput[];
  counts: Record<string, number>;
  activeProjectId: string | null;
}) {
  const tree = buildProjectTree(projects);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: ProjectTreeNode, depth: number) {
    const expanded = !collapsed.has(node.id);
    return (
      <div key={node.id}>
        <ProjectRow
          project={node}
          count={counts[node.id] ?? 0}
          active={activeProjectId === node.id}
          depth={depth}
          hasChildren={node.children.length > 0}
          expanded={expanded}
          onToggleExpand={() => toggle(node.id)}
        />
        {expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return <>{tree.map((node) => renderNode(node, 0))}</>;
}
