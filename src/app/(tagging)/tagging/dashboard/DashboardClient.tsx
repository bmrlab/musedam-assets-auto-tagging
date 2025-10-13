"use client";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ExtractServerActionData } from "@/lib/serverAction";
import { cn } from "@/lib/utils";
import { AssetObjectExtra } from "@/prisma/client";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  DashboardStats,
  fetchDashboardStats,
  fetchMonthlyTrend,
  fetchProcessingTasks,
  fetchWeeklyTaggingData,
  retryAllFailedTasks,
  retryFailedTask,
  TaskWithAsset,
} from "./actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "next-themes";
import { RetryIcon } from "@/components/ui/icons";
import { AssetThumbnail } from "@/components/AssetThumbnail";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardClientProps {
  initialStats: ExtractServerActionData<typeof fetchDashboardStats>["stats"];
  initialTasks: ExtractServerActionData<typeof fetchProcessingTasks>["tasks"];
}

export default function DashboardClient({ initialStats, initialTasks }: DashboardClientProps) {
  const t = useTranslations("Tagging.Dashboard");
  const tCommon = useTranslations("Tagging.Common");

  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [tasks, setTasks] = useState<TaskWithAsset[]>(initialTasks);
  const [weeklyData, setWeeklyData] = useState<Array<{ day: string; count: number }>>([]);
  const [monthlyData, setMonthlyData] = useState<
    Array<{ month: string; completed: number; total: number }>
  >([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [taskFilter, setTaskFilter] = useState<"all" | "processing">("all");
  const [totalTasks, setTotalTasks] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const refreshData = useCallback(
    async (page: number = currentPage, filter: "all" | "processing" = taskFilter, size: number = pageSize, showLoading: boolean = false) => {
      try {
        if (showLoading) {
          setIsLoading(true);
        }
        const [statsResult, tasksResult, weeklyResult, monthlyResult] = await Promise.all([
          fetchDashboardStats(),
          fetchProcessingTasks(page, size, filter),
          fetchWeeklyTaggingData(),
          fetchMonthlyTrend(),
        ]);

        if (statsResult.success) {
          setStats(statsResult.data.stats);
        }
        if (tasksResult.success) {
          setTasks(tasksResult.data.tasks);
          setTotalTasks(tasksResult.data.total);
          setTotalPages(Math.ceil(tasksResult.data.total / size));
        }
        if (weeklyResult.success) {
          setWeeklyData(weeklyResult.data.data);
        }
        if (monthlyResult.success) {
          setMonthlyData(monthlyResult.data.data);
        }
      } catch (error) {
        console.error(tCommon("refreshDataFailed"), error);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [currentPage, taskFilter, tCommon, pageSize],
  );


  const handlePageSizeChange = useCallback(
    (newPageSize: string) => {
      const size = parseInt(newPageSize);
      setPageSize(size);
      setCurrentPage(1);
      refreshData(1, taskFilter, size);
    },
    [taskFilter, refreshData],
  );

  useEffect(() => {
    // Initial load
    refreshData(currentPage, taskFilter, pageSize, true);
  }, [currentPage, taskFilter, refreshData, pageSize]);

  useEffect(() => {
    // Auto refresh every 30 seconds
    const refreshInterval = setInterval(() => {
      refreshData();
    }, 30000);

    // Update current time every second for processing duration
    const timeInterval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(timeInterval);
    };
  }, [refreshData]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    refreshData(page);
  };

  const handleFilterChange = (value: string) => {
    const filter = value as "all" | "processing";
    setTaskFilter(filter);
    setCurrentPage(1);
    refreshData(1, filter);
  };

  const handleRetryTask = async (taskId: number) => {
    const result = await retryFailedTask(taskId);
    if (result.success) {
      toast.success(tCommon("taskAddedToQueue"));
      await refreshData();
    } else {
      toast.error(tCommon("retryFailed"));
    }
  };

  const handleRetryAllTasks = async () => {
    const result = await retryAllFailedTasks();
    if (result.success) {
      toast.success(tCommon("retryTasksSuccess", { count: result.data.count }));
      await refreshData();
    } else {
      toast.error(tCommon("retryFailed"));
    }
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return "0 KB";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const notFinishedTasks = stats.pending + stats.processing;

  const formatDuration = (task: TaskWithAsset) => {
    if (task.status === "processing" && task.startsAt) {
      const seconds = Math.round((currentTime - task.startsAt.getTime()) / 1000);
      if (seconds < 60) return `${seconds}s`;
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
    if (task.status === "completed" && task.startsAt && task.endsAt) {
      const seconds = Math.round((task.endsAt.getTime() - task.startsAt.getTime()) / 1000);
      if (seconds < 60) return `${seconds}s`;
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
    return "";
  };

  const renderPagination = () => {
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    return (
      <div className="flex items-center justify-between gap-2 p-3 border-t">
        <Pagination className="flex-1 mx-0">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                ariaLabel={tCommon("pagination.goToPreviousPage")}
              />
            </PaginationItem>

            {start > 1 && (
              <>
                <PaginationItem>
                  <PaginationLink onClick={() => handlePageChange(1)} className="cursor-pointer">
                    1
                  </PaginationLink>
                </PaginationItem>
                {start > 2 && (
                  <PaginationItem>
                    <PaginationEllipsis morePagesText={tCommon("pagination.morePages")} />
                  </PaginationItem>
                )}
              </>
            )}

            {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  onClick={() => handlePageChange(page)}
                  isActive={currentPage === page}
                  className="cursor-pointer"
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}

            {end < totalPages && (
              <>
                {end < totalPages - 1 && (
                  <PaginationItem>
                    <PaginationEllipsis morePagesText={tCommon("pagination.morePages")} />
                  </PaginationItem>
                )}
                <PaginationItem>
                  <PaginationLink
                    onClick={() => handlePageChange(totalPages)}
                    className="cursor-pointer"
                  >
                    {totalPages}
                  </PaginationLink>
                </PaginationItem>
              </>
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                ariaLabel={tCommon("pagination.goToNextPage")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>

        <div className="flex items-center gap-2 text-sm text-basic-5">
          <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="!h-8 ">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 40, 50, 100].map((item) => (
                <SelectItem key={item} value={item.toString()}>{`${item}条/页`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`;
    }
    return num.toString();
  };

  return (
    <div className="space-y-4">
      {/* Statistics Card - Single card with 4 items */}
      <div className="bg-background border rounded-[6px] p-6">
        {isLoading ? (
          <div className="grid grid-cols-4 gap-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="text-center">
                <Skeleton className="h-8 w-16 mx-auto mb-2" />
                <Skeleton className="h-4 w-24 mx-auto" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-[22px] font-semibold leading-[32px]">{formatNumber(stats.totalCompleted)}</div>
              <div className="flex items-center justify-center gap-[6px] text-xs text-basic-6 mt-1">
                <span className="size-[5px] bg-[#00E096] rounded-full"></span>
                <span>{t("totalCompleted")}</span>
              </div>
            </div>

            <div className="text-center">
              <div className="text-[22px] font-semibold leading-[32px]">{stats.processing}</div>
              <div className="flex items-center justify-center gap-[6px] text-xs text-basic-6 mt-1">
                <span className="size-[5px] bg-primary-6 rounded-full"></span>
                <span>{t("processing")}</span>
              </div>
            </div>

            <div className="text-center">
              <div className="text-[22px] font-semibold leading-[32px]">{stats.pending}</div>
              <div className="flex items-center justify-center gap-[6px] text-xs text-basic-6 mt-1">
                <span className="size-[5px] bg-warning-6 rounded-full"></span>
                <span>{t("pending")}</span>
              </div>
            </div>

            <div className="text-center">
              <div className="text-[22px] font-semibold leading-[32px]">{stats.failed}</div>
              <div className="flex items-center justify-center gap-[6px] text-xs text-basic-6 mt-1">
                <span className="size-[5px] bg-danger-6 rounded-full"></span>
                <span>{t("failed")}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task List Section */}
      <div className="bg-background border rounded-[6px]">
        <div className="flex items-center justify-between py-3 px-5 border-b">
          <div className=" flex items-center gap-4">
            <h2 className="font-semibold">{t("title")}</h2>
            <p className="text-sm text-basic-5">
              {t("remainingTasks", {
                count: notFinishedTasks,
                total: taskFilter === "processing" ? notFinishedTasks : totalTasks,
                minutes: Math.ceil((notFinishedTasks * stats.avgProcessingTime) / 60),
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={taskFilter} onValueChange={handleFilterChange}>
              <SelectTrigger className="!h-8 w-[120px]">
                <SelectValue placeholder={t("filterAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterAll")}</SelectItem>
                <SelectItem value="processing">{t("filterProcessing")}</SelectItem>
              </SelectContent>
            </Select>
            {stats.failed > 0 && <Button size="sm" variant="outline" onClick={handleRetryAllTasks}>
              <RetryIcon className="size-[14px] mr-1" />
              {t("retryFailedTasks")}
            </Button>}
          </div>
        </div>

        {/* Task Items */}
        <div className="tagging-tasks-list">
          {isLoading && tasks.length === 0 ? (
            <div className="max-h-[622px] overflow-y-auto">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-[14px] px-4 py-3">
                  <Skeleton className="shrink-0 size-8 rounded-sm" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="size-4 rounded-full" />
                </div>
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 text-basic-5 text-sm ">
              <Image
                width={171}
                height={120}
                src={isDark ? "/emptyListDark.svg" : "/emptyList.svg"}
                alt="empty"
                className="h-[120px] w-auto mx-auto mb-4"
              />
              <p>{t("noTasks")}</p>
            </div>
          ) : (
            <div className="max-h-[622px] overflow-y-auto">
              {tasks.map((task) => {

                const extra = task.assetObject.extra as AssetObjectExtra | null;
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-[14px] px-4 py-3  transition-all"
                  >
                    {/* Thumbnail or Icon */}
                    <div className="shrink-0 size-8 relative overflow-hidden">
                      <AssetThumbnail asset={{
                        thumbnailUrl: extra?.thumbnailAccessUrl,
                        extension: extra?.extension,
                      }}
                        className="size-8 rounded-sm"
                        maxWidth={32}
                        maxHeight={32}
                      />
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium truncate" title={task.assetObject.name}>
                          {task.assetObject.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs mt-0.5 text-basic-6">
                        <span>
                          {(() => {
                            try {
                              const extra = task.assetObject.extra as AssetObjectExtra | null;
                              return extra?.extension?.toUpperCase() || "UNKNOWN";
                            } catch {
                              return "UNKNOWN";
                            }
                          })()}
                        </span>
                        {(() => {
                          try {
                            const extra = task.assetObject.extra as AssetObjectExtra | null;
                            return extra?.size;
                          } catch (error) {
                            return null;
                          }
                        })() !== null && (
                            <span className="text-basic-5">
                              <span> · </span>
                              {formatFileSize(
                                (() => {
                                  try {
                                    const extra = task.assetObject.extra as AssetObjectExtra | null;
                                    return extra?.size || 0;
                                  } catch (error) {
                                    return 0;
                                  }
                                })(),
                              )}
                              <span> · </span>
                            </span>
                          )}
                        <>
                          {task.status === "failed" ? <span className="text-danger-6">
                            {t("taggingFailed")}
                          </span> : task.status === "pending" ? (
                            <span className="text-xs ">
                              {t("waitingForTagging")}
                            </span>
                          ) : <span className='flex items-center gap-[3px]'>
                            {`${t("aiTaggingTime")}: ${formatDuration(task)}`}
                            {task.status === "completed" && <CheckCircle2 className="size-3 text-[#00E096]" />}
                          </span>}
                        </>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="shrink-0">
                      {task.status === "processing" ? (
                        <span className="w-1.5 h-1.5 bg-primary-6 rounded-full animate-pulse"></span>
                      ) : task.status === "failed" ? (
                        <div className="size-[26px] cursor-pointer transition-all duration-300 ease-in-out flex items-center justify-center group hover:bg-primary-1 rounded-[6px]" onClick={() => handleRetryTask(task.id)} >
                          <RetryIcon className="h-4 w-4 text-basic-6 group-hover:text-basic-8" />
                        </div>
                      )
                        // : task.status === "pending" ? (
                        //   <span className="text-xs text-warning-6">
                        //     {t("waitingForTagging")}
                        //   </span>
                        // ) 
                        // : task.status === "completed" ? (
                        //   <CheckCircle2 className="h-4 w-4 text-[#00E096]" />
                        // ) 
                        : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            renderPagination()
          )}
        </div>
      </div>

      {/* Charts Side by Side - 2:1 ratio */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monthly Trend Chart - Takes 2 columns */}
        <div className="col-span-2 bg-background border rounded-[6px]">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">{t("processingTrend")}</h3>
            {!isLoading && (
              <div className="flex items-center text-basic-6 gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <div className="size-[10px] rounded-full bg-[#0FCA7A]" />
                  <span className="text-xs">{t("initiateTasks")}</span>
                </div>
                <div className="flex items-center gap-2 ">
                  <div className="size-[10px] rounded-full bg-[#00C7F2]" />
                  <span className="text-xs">{t("processTasks")}</span>
                </div>
              </div>
            )}
          </div>
          <div className="p-4">
            {isLoading ? (
              <Skeleton className="w-full h-[250px]" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -30, bottom: -10 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0FCA7A" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#0FCA7A" stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00C7F2" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#00C7F2" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    tickFormatter={(value) => (value >= 1000 ? `${value / 1000}k` : value)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#0FCA7A"
                    strokeWidth={2}
                    fill="url(#colorTotal)"
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    stroke="#00C7F2"
                    strokeWidth={2}
                    fill="url(#colorCompleted)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Weekly Tagging Chart - Takes 1 column */}
        <div className="bg-background border rounded-[6px]">
          <div className="p-4 border-b">
            <h3 className="font-semibold">{t("weeklyTagging")}</h3>
          </div>
          <div className="p-4">
            {isLoading ? (
              <Skeleton className="w-full h-[250px]" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={weeklyData}
                  barGap={8}
                  margin={{ top: 10, right: 10, left: -30, bottom: -10 }}
                >
                  <defs>
                    <linearGradient id="colorBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    strokeOpacity={0.5}
                    horizontal={true}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    tickFormatter={(value) => (value >= 1000 ? `${value / 1000}k` : value)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                    }}
                  />
                  <Bar dataKey="count" fill="url(#colorBar)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
