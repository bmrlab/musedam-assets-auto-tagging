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
import { CheckCircle2, RefreshCw } from "lucide-react";
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

  const refreshData = useCallback(
    async (page: number = currentPage, filter: "all" | "processing" = taskFilter) => {
      try {
        const [statsResult, tasksResult, weeklyResult, monthlyResult] = await Promise.all([
          fetchDashboardStats(),
          fetchProcessingTasks(page, 10, filter),
          fetchWeeklyTaggingData(),
          fetchMonthlyTrend(),
        ]);

        if (statsResult.success) {
          setStats(statsResult.data.stats);
        }
        if (tasksResult.success) {
          setTasks(tasksResult.data.tasks);
          setTotalTasks(tasksResult.data.total);
          setTotalPages(Math.ceil(tasksResult.data.total / 10));
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
    [currentPage, taskFilter, tCommon],
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

  const getThumbnailUrl = (task: TaskWithAsset): string | null => {
    try {
      const extra = task.assetObject.extra as AssetObjectExtra | null;
      return extra?.thumbnailAccessUrl || null;
    } catch (error) {
      console.warn("Failed to parse asset extra data:", error);
      return null;
    }
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
    const videoExts = ["mp4", "mov", "avi", "mkv", "webm"];
    const docExts = ["pdf", "doc", "docx", "txt", "md"];

    if (imageExts.includes(extension || "")) return "🖼️";
    if (videoExts.includes(extension || "")) return "🎬";
    if (docExts.includes(extension || "")) return "📄";
    return "📁";
  };

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
      <Pagination className="w-auto mx-0">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              className={cn(
                "cursor-pointer",
                currentPage === 1 && "pointer-events-none opacity-50",
              )}
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
                  <PaginationEllipsis />
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
                  <PaginationEllipsis />
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
                currentPage === totalPages && "pointer-events-none opacity-50",
              )}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
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
            <div className="text-3xl font-bold">{formatNumber(stats.totalCompleted)}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground mt-2">
              <span className="w-2 h-2 bg-green-600 dark:bg-green-400 rounded-full"></span>
              <span>{t("totalCompleted")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold">{stats.processing}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground mt-2">
              <span className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full"></span>
              <span>{t("processing")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold">{stats.pending}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground mt-2">
              <span className="w-2 h-2 bg-orange-600 dark:bg-orange-400 rounded-full"></span>
              <span>{t("pending")}</span>
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold">{stats.failed}</div>
            <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground mt-2">
              <span className="w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full"></span>
              <span>{t("failed")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Task List Section */}
      <div className="bg-background border rounded-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold">{t("title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("remainingTasks", {
                count: totalTasks,
                total: stats.pending + stats.processing + stats.failed,
                minutes: Math.ceil(
                  ((stats.pending + stats.processing) * stats.avgProcessingTime) / 60,
                ),
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup value={taskFilter} onValueChange={handleFilterChange}>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="processing" />
                  <span className="text-sm">{t("filterProcessing")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="all" />
                  <span className="text-sm">{t("filterAll")}</span>
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
        <div className="divide-y">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p>{t("noTasks")}</p>
            </div>
          ) : (
            tasks.map((task) => {
              const thumbnailUrl = getThumbnailUrl(task);
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  {/* Thumbnail or Icon */}
                  <div className="shrink-0 w-12 h-12 relative rounded overflow-hidden bg-muted">
                    {thumbnailUrl ? (
                      <Image
                        src={thumbnailUrl}
                        alt={task.assetObject.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xl">
                        {getFileIcon(task.assetObject.name)}
                      </div>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium truncate" title={task.assetObject.name}>
                        {task.assetObject.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
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
                          <>
                            <span>·</span>
                            <span>
                              {formatFileSize(
                                (() => {
                                  try {
                                    const extra = task.assetObject.extra as AssetObjectExtra | null;
                                    return extra?.size || 0;
                                  } catch (error) {
                                    return 0;
                                  }
                                })()
                              )}
                            </span>
                          </>
                        )}
                      <>
                        <span>·</span>
                        <span>
                          {t("aiTaggingTime")}: {formatDuration(task)}
                        </span>
                      </>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="shrink-0">
                    {task.status === "processing" ? (
                      <span className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse"></span>
                    ) : task.status === "pending" ? (
                      <span className="text-xs text-orange-600 dark:text-orange-400">{t("waitingForTagging")}</span>
                    ) : task.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 h-auto py-0.5 px-2 text-xs"
                        onClick={() => handleRetryTask(task.id)}
                      >
                        {t("taggingFailed")}
                      </Button>
                    ) : task.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between">
            {renderPagination()}
            <span className="shrink-0 text-sm text-muted-foreground">
              {t("paginationInfo", { current: tasks.length, total: totalTasks })}
            </span>
          </div>
        )}
      </div>

      {/* Charts Side by Side - 2:1 ratio */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monthly Trend Chart - Takes 2 columns */}
        <div className="col-span-2 bg-background border rounded-lg">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">{t("processingTrend")}</h3>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#10b981" }} />
                <span className="text-sm text-muted-foreground">{t("initiateTasks")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
                <span className="text-sm text-muted-foreground">{t("processTasks")}</span>
              </div>
            </div>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -30, bottom: -10 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.2} />
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
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#colorTotal)"
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  stroke="#60a5fa"
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
