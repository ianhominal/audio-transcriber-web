import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

/** Skeleton del dashboard mientras Next.js resuelve los datos de la ruta (streaming/loading.tsx). */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-8 md:grid md:grid-cols-[16rem_1fr] md:items-start">
      <aside className="mb-6 space-y-3 md:mb-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="mt-6">
          <SkeletonList count={5} />
        </div>
      </main>
    </div>
  );
}
