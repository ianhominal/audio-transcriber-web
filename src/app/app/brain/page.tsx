import Link from "next/link";
import { BrainChat } from "./brain-chat";

/**
 * "Segundo cerebro" (feature 2026-07-13, see brief): página dedicada al chat con IA sobre TODAS las
 * notas del usuario. Server component mínimo — auth ya la resuelve `AppLayout` (`src/app/app/layout.tsx`,
 * redirige a `/login` sin sesión); no hace falta traer datos acá porque `BrainChat` (client) habla
 * directo con `/api/brain`, que hace su propio retrieval scopeado por dueño (ver ese route).
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">🧠 Segundo cerebro</h1>
        <p className="mt-1 text-sm text-secondary">
          Preguntale a la IA sobre todas tus notas: pedile que junte ideas repartidas en varias
          transcripciones, que te recuerde qué dijiste sobre un tema, o que busque tareas pendientes.
        </p>
      </div>

      <BrainChat />
    </div>
  );
}
