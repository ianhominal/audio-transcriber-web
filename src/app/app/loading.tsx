import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

/** Skeleton del dashboard mientras Next.js resuelve los datos de la ruta (streaming/loading.tsx). */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-8 md:grid md:grid-cols-[16rem_1fr] md:items-start">
      <aside className="mb-6 space-y-3 md:mb-0">
        <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        {/* Breadcrumb */}
        <Skeleton className="mb-3 h-4 w-40" />
        {/* Cabecera del proyecto (si termina siendo el explorador) */}
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-full max-w-md" />
        </div>
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-40" />
        </div>
        {/* Subcarpetas */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
        {/* Transcripciones */}
        <div className="mt-5">
          <SkeletonList count={4} />
        </div>
      </main>
    </div>
  );
}
