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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ExtractServerActionData } from "@/lib/serverAction";
import { cn } from "@/lib/utils";
import { AssetObjectExtra } from "@/prisma/client";
import { CheckCircle2, RefreshCw, RefreshCwIcon } from "lucide-react";
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
  const [taskFilter, setTaskFilter] = useState<"all" | "processing">("processing");
  const [totalTasks, setTotalTasks] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const refreshData = useCallback(
    async (page: number = currentPage, filter: "all" | "processing" = taskFilter, size: number = pageSize) => {
      try {
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
    refreshData(currentPage, taskFilter);
  }, [currentPage, taskFilter, refreshData]);

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
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getThumbnailUrl = (task: TaskWithAsset): string => {
    try {
      const extra = task.assetObject.extra as AssetObjectExtra | null;
      return extra?.thumbnailAccessUrl ?? "/file.svg";
    } catch (error) {
      console.warn("Failed to parse asset extra data:", error);
      return "/file.svg";
    }
  };

  // const getFileIcon = (fileName: string) => {
  //   const extension = fileName.split(".").pop()?.toLowerCase();
  //   const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
  //   const videoExts = ["mp4", "mov", "avi", "mkv", "webm"];
  //   const docExts = ["pdf", "doc", "docx", "txt", "md"];

  //   if (imageExts.includes(extension || "")) return "🖼️";
  //   if (videoExts.includes(extension || "")) return "🎬";
  //   if (docExts.includes(extension || "")) return "📄";
  //   return "📁";
  // };

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
      <div className="flex items-center justify-between gap-2 p-4 border-t ">
        <Pagination className="flex-1 mx-0">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                className={cn(
                  "cursor-pointer",
                  currentPage === 1 && "pointer-events-none opacity-50 cursor-not-allowed",
                )}
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
                className={cn(
                  "cursor-pointer",
                  currentPage === totalPages && "pointer-events-none opacity-50 cursor-not-allowed",
                )}
                ariaLabel={tCommon("pagination.goToNextPage")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>

        <div className="flex items-center gap-2 text-sm text-basic-5">
          <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="!h-8">
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
      <div className="bg-background border rounded-lg p-6">
        <div className="grid grid-cols-4 gap-8">
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-[32px]">{formatNumber(stats.totalCompleted)}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-basic-6 mt-1">
              <span className="size-[5px] bg-[#00E096] rounded-full"></span>
              <span>{t("totalCompleted")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-[22px] font-semibold leading-[32px]">{stats.processing}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-basic-6 mt-1">
              <span className="size-[5px] bg-primary-6 rounded-full"></span>
              <span>{t("processing")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-[22px] font-semibold leading-[32px]">{stats.pending}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-basic-6 mt-1">
              <span className="size-[5px] bg-warning-6 rounded-full"></span>
              <span>{t("pending")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-[22px] font-semibold leading-[32px]">{stats.failed}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-basic-6 mt-1">
              <span className="size-[5px] bg-danger-6 rounded-full"></span>
              <span>{t("failed")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Task List Section */}
      <div className="bg-background border rounded-lg">
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
            <RadioGroup value={taskFilter} onValueChange={handleFilterChange}>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="all" />
                  <span className="text-sm">{t("filterAll")}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="processing" />
                  <span className="text-sm">{t("filterProcessing")}</span>
                </label>
              </div>
            </RadioGroup>
            <Button size="sm" variant="outline" onClick={handleRetryAllTasks}>
              <RefreshCw className="h-3 w-3 mr-1" />
              {t("retryFailedTasks")}
            </Button>
          </div>
        </div>

        {/* Task Items */}
        <div className="">
          {tasks.length === 0 ? (
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
            tasks.map((task) => {
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-[14px] px-4 py-3  transition-all"
                >
                  {/* Thumbnail or Icon */}
                  <div className="shrink-0 size-8 relative overflow-hidden bg-muted">
                    <Image
                      src={getThumbnailUrl(task)}
                      alt={task.assetObject.name}
                      fill
                      sizes="32px"
                      className="object-cover"
                    />
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-medium truncate" title={task.assetObject.name}>
                        {task.assetObject.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs mt-0.5">
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
                      })() && (
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
                        </span> : <span>
                          {`${t("aiTaggingTime")}: ${formatDuration(task)}`}
                        </span>}
                      </>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="shrink-0">
                    {task.status === "processing" ? (
                      <span className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse"></span>
                    ) : task.status === "pending" ? (
                      <span className="text-xs text-orange-600 dark:text-orange-400">
                        {t("waitingForTagging")}
                      </span>
                    ) : task.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-6  h-auto py-0.5 px-2 text-xs"
                        onClick={() => handleRetryTask(task.id)}
                      >
                        <RefreshCwIcon />
                      </Button>
                    ) : task.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-[#00E096]" />
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          renderPagination()
        )}
      </div>

      {/* Charts Side by Side - 2:1 ratio */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monthly Trend Chart - Takes 2 columns */}
        <div className="col-span-2 bg-background border rounded-lg">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">{t("processingTrend")}</h3>
            <div className="flex items-center text-basic-6 gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="size-[10px] rounded-full bg-[#0FCA7A]" />
                <span className="text-xs">{t("initiateTasks")}</span>
              </div>
              <div className="flex items-center gap-2 bg-[#00C7F2]">
                <div className="size-[10px] rounded-full" />
                <span className="text-xs">{t("processTasks")}</span>
              </div>
            </div>
          </div>
          <div className="p-4">
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
          </div>
        </div>

        {/* Weekly Tagging Chart - Takes 1 column */}
        <div className="bg-background border rounded-lg">
          <div className="p-4 border-b">
            <h3 className="font-semibold">{t("weeklyTagging")}</h3>
          </div>
          <div className="p-4">
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
          </div>
        </div>
      </div>
    </div>
  );
}
