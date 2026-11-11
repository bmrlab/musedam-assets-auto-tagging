import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="loading">
      <div className="bg-background border rounded-[6px] p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col items-center gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-background border rounded-[6px]">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 px-5 border-b">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-[220px]" />
        </div>
        <div className="px-4 py-2 space-y-3">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex items-center gap-[14px] py-2">
              <Skeleton className="size-8 rounded-sm shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3 max-w-[240px]" />
                <Skeleton className="h-3 w-1/2 max-w-[320px]" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="bg-background border rounded-[6px] lg:col-span-2 p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="w-full h-[250px]" />
        </div>
        <div className="bg-background border rounded-[6px] p-4">
          <Skeleton className="h-5 w-28 mb-4" />
          <Skeleton className="w-full h-[250px]" />
        </div>
      </div>
    </div>
  );
}
