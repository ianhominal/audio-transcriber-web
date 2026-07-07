import { Skeleton } from "@/components/ui/Skeleton";

/** Skeleton de Ajustes mientras carga el estado de la conexión con Drive. */
export default function AjustesLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
        </div>
        <Skeleton className="mt-4 h-10 w-48" />
      </div>
    </div>
  );
}
