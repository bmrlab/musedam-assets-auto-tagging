"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ExtractServerActionData } from "@/lib/serverAction";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DashboardStats,
  fetchContentTypeStats,
  fetchDashboardStats,
  fetchProcessingTasks,
  retryFailedTask,
  TaskWithAsset,
} from "./actions";

interface DashboardClientProps {
  initialStats: ExtractServerActionData<typeof fetchDashboardStats>["stats"];
  initialTasks: ExtractServerActionData<typeof fetchProcessingTasks>["tasks"];
}

export default function DashboardClient({ initialStats, initialTasks }: DashboardClientProps) {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [tasks, setTasks] = useState<TaskWithAsset[]>(initialTasks);
  const [contentStats, setContentStats] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const [statsResult, tasksResult, contentResult] = await Promise.all([
        fetchDashboardStats(),
        fetchProcessingTasks(1, 20),
        fetchContentTypeStats(),
      ]);

      if (statsResult.success) {
        setStats(statsResult.data.stats);
      }
      if (tasksResult.success) {
        setTasks(tasksResult.data.tasks);
      }
      if (contentResult.success) {
        setContentStats(contentResult.data);
      }
    } catch (error) {
      console.error("刷新数据失败:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // 初始化加载内容统计
    fetchContentTypeStats().then((result) => {
      if (result.success) {
        setContentStats(result.data);
      }
    });

    // 每30秒自动刷新
    const refreshInterval = setInterval(refreshData, 30000);

    // 每秒更新当前时间，用于计算进行中任务的耗时
    const timeInterval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(timeInterval);
    };
  }, []);

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "webp":
        return "🖼️";
      case "mp4":
      case "mov":
      case "avi":
        return "🎬";
      case "pdf":
        return "📄";
      case "doc":
      case "docx":
        return "📝";
      default:
        return "📁";
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processing":
        return "text-blue-600 dark:text-blue-400";
      case "pending":
        return "text-orange-600 dark:text-orange-400";
      case "completed":
        return "text-green-600 dark:text-green-400";
      case "failed":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "processing":
        return "处理中";
      case "pending":
        return "等待处理";
      case "completed":
        return "已完成";
      case "failed":
        return "处理失败";
      default:
        return "未知状态";
    }
  };

  const handleRetryTask = async (taskId: number) => {
    const result = await retryFailedTask(taskId);
    if (result.success) {
      await refreshData();
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部统计卡片 */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">AI 自动打标</h1>
        <Button onClick={refreshData} disabled={isRefreshing} variant="outline" size="sm">
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isRefreshing ? "刷新中..." : "刷新"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 总成功打标资产 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {stats.totalCompleted.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">总成功打标资产</div>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
          </CardContent>
        </Card>

        {/* 正在打标中 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {stats.processing}
                </div>
                <div className="text-sm text-muted-foreground">正在打标中</div>
              </div>
              <Loader2 className="h-8 w-8 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
          </CardContent>
        </Card>

        {/* 等待打标 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {stats.pending}
                </div>
                <div className="text-sm text-muted-foreground">等待打标</div>
              </div>
              <Clock className="h-8 w-8 text-orange-600 dark:text-orange-400" />
            </div>
          </CardContent>
        </Card>

        {/* 打标失败 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {stats.failed}
                </div>
                <div className="text-sm text-muted-foreground">打标失败</div>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：AI 自动打标中 */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">AI 自动打标中</h2>
              <p className="text-sm text-muted-foreground">
                剩余 {tasks.length} / {stats.pending + stats.processing + stats.failed} 项，预计{" "}
                {Math.ceil(((stats.pending + stats.processing) * stats.avgProcessingTime) / 60)}{" "}
                分钟后完成
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refreshData}>
              重试失败任务
            </Button>
          </div>

          <div className="space-y-3">
            {tasks.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4" />
                  <p>暂无正在处理的任务</p>
                </CardContent>
              </Card>
            ) : (
              tasks.map((task) => (
                <Card key={task.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      {/* 文件图标 */}
                      <div className="w-10 h-10 flex items-center justify-center bg-muted rounded-lg">
                        {getFileIcon(task.assetObject.name)}
                      </div>

                      {/* 文件信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" title={task.assetObject.name}>
                          {task.assetObject.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {task.assetObject.name.split(".").pop()?.toUpperCase() || "FILE"}
                          {task.status === "processing" && task.startsAt && (
                            <span className="ml-2">
                              • AI 打标时间:{" "}
                              {Math.round((currentTime - task.startsAt.getTime()) / 1000)}s
                            </span>
                          )}
                          {task.status === "pending" && <span className="ml-2">• 等待开始</span>}
                          {task.status === "failed" && (
                            <span className="ml-2 text-red-600 dark:text-red-400">• 处理失败</span>
                          )}
                        </div>
                      </div>

                      {/* 状态 */}
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${getStatusColor(task.status)}`}>
                          {getStatusText(task.status)}
                        </span>
                        {task.status === "processing" && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {task.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetryTask(task.id)}
                          >
                            重试
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 进度条（仅处理中显示） */}
                    {task.status === "processing" && (
                      <div className="mt-3">
                        <Progress value={undefined} className="h-1" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* 右侧：实时处理和数据统计 */}
        <div className="space-y-6">
          {/* 实时处理 */}
          {contentStats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">实时处理</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileImage className="h-4 w-4 text-green-600" />
                    <span className="text-sm">图像内容解析</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{contentStats.imageAnalysis.count}</div>
                    <div className="text-xs text-muted-foreground">
                      平均 {contentStats.imageAnalysis.avgTime}s/项
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span className="text-sm">文档内容解析</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{contentStats.textAnalysis.count}</div>
                    <div className="text-xs text-muted-foreground">
                      平均 {contentStats.textAnalysis.avgTime}s/项
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileVideo className="h-4 w-4 text-purple-600" />
                    <span className="text-sm">视频内容解析</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{contentStats.videoAnalysis.count}</div>
                    <div className="text-xs text-muted-foreground">
                      平均 {contentStats.videoAnalysis.avgTime}s/项
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 数据统计 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">数据统计</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {stats.totalCompleted.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">总成功打标资产</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {stats.monthlyCompleted}
                  </div>
                  <div className="text-xs text-muted-foreground">本月打标资产</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {stats.dailyCompleted}
                  </div>
                  <div className="text-xs text-muted-foreground">今日打标资产数</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {formatDuration(stats.avgProcessingTime)}
                  </div>
                  <div className="text-xs text-muted-foreground">平均打标速度</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {stats.processing}
                  </div>
                  <div className="text-xs text-muted-foreground">正在打标中</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {stats.pending}
                  </div>
                  <div className="text-xs text-muted-foreground">等待打标</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
