/** Bloque base con pulso de carga. Componer con className para dar forma (línea, círculo, tarjeta). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} aria-hidden="true" />;
}

/** Fila de skeleton para listas de transcripciones/proyectos. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

/** Lista de N filas skeleton, para reemplazar la lista de transcripciones mientras carga. */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Cargando…">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
