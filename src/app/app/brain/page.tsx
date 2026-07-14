import Link from "next/link";
import { ChatPanel } from "@/components/app/chat-panel";

/**
 * "Chat con IA" en scope "Todas mis notas" (antes "Segundo cerebro", unificado en un solo
 * componente — ver `ChatPanel`, `src/lib/chat/scope.ts`). Server component mínimo — auth ya la
 * resuelve `AppLayout` (`src/app/app/layout.tsx`, redirige a `/login` sin sesión); no hace falta
 * traer datos acá porque `ChatPanel` (client) habla directo con `/api/brain`, que hace su propio
 * retrieval scopeado por dueño (ver ese route). Sin `transcriptionId`: `ChatPanel` queda fijo en
 * scope "all" y no muestra el selector de alcance (esta página no tiene contexto de nota).
 */
export default function BrainPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/app"
        className="text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:text-accent"
      >
        ← Volver
      </Link>

      <div className="mt-3 mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Chat con IA</h1>
      </div>

      <ChatPanel defaultScope="all" />
    </div>
  );
}
