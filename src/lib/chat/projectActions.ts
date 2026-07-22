/**
 * "Acciones rápidas" del scope "project" ("Este proyecto") en `ChatPanel` — feature 2026-07-22 fase
 * 2: "Resumir" y "Próximos pasos" son PREGUNTAS PRESET al brain (mismo endpoint/flujo que cualquier
 * mensaje del scope "project", ver `resolveChatRequestConfig` en `./scope.ts`), no una feature nueva
 * — solo reusan `sendMessage` con un texto fijo en vez de lo que la usuaria hubiera escrito a mano.
 * PURA (sin dependencias de React) para poder testear el mapeo acción → texto sin renderizar nada,
 * mismo criterio que el resto de `src/lib` (ver `vitest.config.mts`: Vitest cubre lógica pura, la UI
 * se testea con Playwright).
 */
export type ProjectQuickAction = "summarize" | "next-steps";

const PROJECT_QUICK_ACTION_MESSAGES: Record<ProjectQuickAction, string> = {
  summarize: "Resumí este proyecto en los puntos clave.",
  "next-steps": "¿Cuáles son los próximos pasos o pendientes según estas notas?",
};

/** Texto canned que se manda por el mismo flujo de chat (`sendMessage`) al tocar la acción rápida. */
export function buildProjectQuickActionMessage(action: ProjectQuickAction): string {
  return PROJECT_QUICK_ACTION_MESSAGES[action];
}
