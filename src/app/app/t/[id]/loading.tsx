import { Skeleton } from "@/components/ui/Skeleton";

/** Skeleton del detalle de una transcripción mientras carga. */
export default function TranscriptionDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-4 w-16" />
      <div className="mt-4 flex items-start gap-2">
        <Skeleton className="h-9 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-16 w-full rounded-lg" />
      <Skeleton className="mt-4 h-12 w-full rounded-lg" />
      <Skeleton className="mt-5 h-64 w-full rounded-xl" />
    </div>
  );
}
