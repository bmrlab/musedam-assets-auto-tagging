import { Skeleton } from "@/components/ui/skeleton";

/** Match ReviewItem's asset header and the panels shown by the active filter. */
export function ReviewListSkeleton({
  contentScope,
  label,
}: {
  contentScope: "all" | "tags" | "features";
  label: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="min-h-[240px] flex-1 space-y-[10px] overflow-y-auto max-md:flex-none max-md:overflow-visible"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} aria-hidden="true" className="min-w-0 space-y-6 rounded-[6px] border bg-background p-3 md:px-6 md:pb-6 md:pt-8">
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="size-[86px] shrink-0 rounded-[10px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-3/4 max-w-80" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex gap-2 max-sm:w-full max-sm:justify-end">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-7 w-16" />
            </div>
          </div>
          {contentScope !== "features" && (
            <div className="flex flex-col gap-3 rounded-md bg-basic-1/80 p-4 dark:bg-basic-1">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-6 w-24" />
              </div>
            </div>
          )}
          {contentScope !== "tags" && (
            <div className="flex flex-col gap-3 rounded-md bg-basic-1/80 p-4 dark:bg-basic-1">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {[0, 1].map((row) => (
                  <div key={row} className="flex min-w-0 items-start gap-3 rounded-md border p-3">
                    <Skeleton className="size-10 shrink-0 rounded" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
