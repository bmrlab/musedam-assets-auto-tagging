"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import {
  AssetObject,
  AssetObjectExtra,
  TaggingQueueItem,
  TaggingQueueStatus,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";

export type DashboardStats = {
  totalCompleted: number;
  processing: number;
  pending: number;
  failed: number;
  totalAssets: number;
  monthlyCompleted: number;
  dailyCompleted: number;
  avgProcessingTime: number; // 平均处理时间（秒）
};

export type TaskWithAsset = Omit<TaggingQueueItem, "assetObject"> & {
  assetObject: Omit<AssetObject, "extra"> & {
    extra: AssetObjectExtra;
  };
};

export async function fetchDashboardStats(): Promise<
  ServerActionResult<{
    stats: DashboardStats;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取基础统计
      const [totalCompleted, processing, pending, failed, totalAssets] = await Promise.all([
        prisma.taggingQueueItem.count({
          where: { teamId, status: "completed" },
        }),
        prisma.taggingQueueItem.count({
          where: { teamId, status: "processing" },
        }),
        prisma.taggingQueueItem.count({
          where: { teamId, status: "pending" },
        }),
        prisma.taggingQueueItem.count({
          where: { teamId, status: "failed" },
        }),
        prisma.assetObject.count({
          where: { teamId },
        }),
      ]);

      // 获取本月完成的任务数
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlyCompleted = await prisma.taggingQueueItem.count({
        where: {
          teamId,
          status: "completed",
          endsAt: {
            gte: startOfMonth,
          },
        },
      });

      // 获取今日完成的任务数
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const dailyCompleted = await prisma.taggingQueueItem.count({
        where: {
          teamId,
          status: "completed",
          endsAt: {
            gte: startOfDay,
          },
        },
      });

      // 计算平均处理时间（获取最近100个完成的任务）
      const recentCompletedTasks = await prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          status: "completed",
          startsAt: { not: null },
          endsAt: { not: null },
        },
        orderBy: { endsAt: "desc" },
        take: 100,
      });

      let avgProcessingTime = 0;
      if (recentCompletedTasks.length > 0) {
        const totalProcessingTime = recentCompletedTasks.reduce((sum, task) => {
          if (task.startsAt && task.endsAt) {
            return sum + (task.endsAt.getTime() - task.startsAt.getTime());
          }
          return sum;
        }, 0);
        avgProcessingTime = Math.round(totalProcessingTime / recentCompletedTasks.length / 1000); // 转换为秒
      }

      const stats: DashboardStats = {
        totalCompleted,
        processing,
        pending,
        failed,
        totalAssets,
        monthlyCompleted,
        dailyCompleted,
        avgProcessingTime,
      };

      return {
        success: true,
        data: { stats },
      };
    } catch (error) {
      console.error("获取dashboard统计失败:", error);
      return {
        success: false,
        message: "获取统计数据失败",
      };
    }
  });
}

export async function fetchProcessingTasks(
  page: number = 1,
  limit: number = 20,
  filter: "all" | "processing" = "all",
): Promise<
  ServerActionResult<{
    tasks: TaskWithAsset[];
    total: number;
    hasMore: boolean;
    page: number;
    limit: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const offset = (page - 1) * limit;

      const whereClause =
        filter === "all"
          ? { teamId }
          : {
              teamId,
              status: { in: ["processing", "pending"] as TaggingQueueStatus[] },
            };

      const [tasks, total] = await Promise.all([
        prisma.taggingQueueItem.findMany({
          where: whereClause,
          include: {
            assetObject: true,
          },
          orderBy: [
            { status: "asc" }, // processing 优先
            { createdAt: "desc" },
          ],
          skip: offset,
          take: limit,
        }),
        prisma.taggingQueueItem.count({
          where: whereClause,
        }),
      ]);

      const hasMore = offset + tasks.length < total;

      return {
        success: true,
        data: {
          tasks: tasks as TaskWithAsset[],
          total,
          hasMore,
          page,
          limit,
        },
      };
    } catch (error) {
      console.error("获取处理中任务失败:", error);
      return {
        success: false,
        message: "获取任务列表失败",
      };
    }
  });
}

export async function fetchContentTypeStats(): Promise<
  ServerActionResult<{
    imageAnalysis: { count: number; avgTime: number };
    textAnalysis: { count: number; avgTime: number };
    videoAnalysis: { count: number; avgTime: number };
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取最近完成的任务用于分析
      const recentTasks = await prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          status: "completed",
          startsAt: { not: null },
          endsAt: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // 最近24小时
          },
        },
        include: {
          assetObject: true,
        },
      });

      // 按文件类型分类统计
      const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
      const videoExtensions = ["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm"];
      const textExtensions = ["txt", "doc", "docx", "pdf", "md", "rtf"];

      const getFileType = (fileName: string) => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        if (imageExtensions.includes(ext)) return "image";
        if (videoExtensions.includes(ext)) return "video";
        if (textExtensions.includes(ext)) return "text";
        return "other";
      };

      const imageTask = recentTasks.filter(
        (task) => getFileType(task.assetObject?.name ?? "") === "image",
      );
      const textTasks = recentTasks.filter(
        (task) => getFileType(task.assetObject?.name ?? "") === "text",
      );
      const videoTasks = recentTasks.filter(
        (task) => getFileType(task.assetObject?.name ?? "") === "video",
      );

      const calculateAvgTime = (tasks: typeof recentTasks) => {
        if (tasks.length === 0) return 0;
        const totalTime = tasks.reduce((sum, task) => {
          if (task.startsAt && task.endsAt) {
            return sum + (task.endsAt.getTime() - task.startsAt.getTime());
          }
          return sum;
        }, 0);
        return Math.round(totalTime / tasks.length / 1000); // 转换为秒
      };

      return {
        success: true,
        data: {
          imageAnalysis: {
            count: imageTask.length,
            avgTime: calculateAvgTime(imageTask),
          },
          textAnalysis: {
            count: textTasks.length,
            avgTime: calculateAvgTime(textTasks),
          },
          videoAnalysis: {
            count: videoTasks.length,
            avgTime: calculateAvgTime(videoTasks),
          },
        },
      };
    } catch (error) {
      console.error("获取内容类型统计失败:", error);
      return {
        success: false,
        message: "获取内容类型统计失败",
      };
    }
  });
}

export async function retryFailedTask(taskId: number): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const task = await prisma.taggingQueueItem.findFirst({
        where: { id: taskId, teamId, status: "failed" },
      });

      if (!task) {
        return {
          success: false,
          message: "任务不存在或无权限操作",
        };
      }

      await prisma.taggingQueueItem.update({
        where: { id: taskId },
        data: {
          status: "pending",
          startsAt: null,
          endsAt: null,
          result: {},
        },
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("重试失败任务失败:", error);
      return {
        success: false,
        message: "重试任务失败",
      };
    }
  });
}

export async function retryAllFailedTasks(): Promise<ServerActionResult<{ count: number }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const result = await prisma.taggingQueueItem.updateMany({
        where: { teamId, status: "failed" },
        data: {
          status: "pending",
          startsAt: null,
          endsAt: null,
          result: {},
        },
      });

      return {
        success: true,
        data: { count: result.count },
      };
    } catch (error) {
      console.error("重试所有失败任务失败:", error);
      return {
        success: false,
        message: "重试任务失败",
      };
    }
  });
}

export async function fetchWeeklyTaggingData(): Promise<
  ServerActionResult<{
    data: Array<{
      day: string;
      count: number;
    }>;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const today = new Date();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const tasks = await prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          status: "completed",
          endsAt: {
            gte: weekAgo,
            lte: today,
          },
        },
        select: {
          endsAt: true,
        },
      });

      const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const data = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekAgo);
        date.setDate(weekAgo.getDate() + i);
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        const count = tasks.filter((task) => {
          if (!task.endsAt) return false;
          return task.endsAt >= dayStart && task.endsAt <= dayEnd;
        }).length;

        return {
          day: dayNames[date.getDay()],
          count,
        };
      });

      return {
        success: true,
        data: { data },
      };
    } catch (error) {
      console.error("获取每周打标数据失败:", error);
      return {
        success: false,
        message: "获取数据失败",
      };
    }
  });
}

export async function fetchStrategyDistribution(): Promise<
  ServerActionResult<{
    data: Array<{
      name: string;
      value: number;
      percentage: number;
    }>;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const tasks = await prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          status: "completed",
        },
        select: {
          result: true,
        },
      });

      const strategies = {
        direct: 0,
        name: 0,
        content: 0,
        keyword: 0,
      };

      tasks.forEach((task) => {
        const result = task.result as { strategy?: string };
        if (result?.strategy) {
          switch (result.strategy) {
            case "direct":
              strategies.direct++;
              break;
            case "name":
              strategies.name++;
              break;
            case "content":
              strategies.content++;
              break;
            case "keyword":
              strategies.keyword++;
              break;
          }
        }
      });

      const total = Object.values(strategies).reduce((sum, val) => sum + val, 0);

      const data = [
        {
          name: "直接匹配",
          value: strategies.direct,
          percentage: total > 0 ? Math.round((strategies.direct / total) * 100) : 0,
        },
        {
          name: "名称匹配",
          value: strategies.name,
          percentage: total > 0 ? Math.round((strategies.name / total) * 100) : 0,
        },
        {
          name: "内容匹配",
          value: strategies.content,
          percentage: total > 0 ? Math.round((strategies.content / total) * 100) : 0,
        },
        {
          name: "关键词匹配",
          value: strategies.keyword,
          percentage: total > 0 ? Math.round((strategies.keyword / total) * 100) : 0,
        },
      ];

      return {
        success: true,
        data: { data },
      };
    } catch (error) {
      console.error("获取策略分布失败:", error);
      return {
        success: false,
        message: "获取数据失败",
      };
    }
  });
}

export async function fetchMonthlyTrend(): Promise<
  ServerActionResult<{
    data: Array<{
      month: string;
      completed: number;
      total: number;
    }>;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const months = [];
      const monthNames = [
        "1月",
        "2月",
        "3月",
        "4月",
        "5月",
        "6月",
        "7月",
        "8月",
        "9月",
        "10月",
        "11月",
        "12月",
      ];

      for (let i = 11; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

        const [completed, total] = await Promise.all([
          prisma.taggingQueueItem.count({
            where: {
              teamId,
              status: "completed",
              endsAt: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
          }),
          prisma.taggingQueueItem.count({
            where: {
              teamId,
              createdAt: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
          }),
        ]);

        months.push({
          month: monthNames[date.getMonth()],
          completed,
          total,
        });
      }

      return {
        success: true,
        data: { data: months },
      };
    } catch (error) {
      console.error("获取月度趋势失败:", error);
      return {
        success: false,
        message: "获取数据失败",
      };
    }
  });
}
