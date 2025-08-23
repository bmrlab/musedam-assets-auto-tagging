"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetObject, TaggingQueueItem } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export interface DashboardStats {
  totalCompleted: number;
  processing: number;
  pending: number;
  failed: number;
  totalAssets: number;
  monthlyCompleted: number;
  dailyCompleted: number;
  avgProcessingTime: number; // 平均处理时间（秒）
}

export interface TaskWithAsset extends TaggingQueueItem {
  assetObject: AssetObject;
}

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
): Promise<
  ServerActionResult<{
    tasks: TaskWithAsset[];
    total: number;
    hasMore: boolean;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const offset = (page - 1) * limit;

      const [tasks, total] = await Promise.all([
        prisma.taggingQueueItem.findMany({
          where: {
            teamId,
            status: { in: ["processing", "pending", "failed"] },
          },
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
          where: {
            teamId,
            status: { in: ["processing", "pending", "failed"] },
          },
        }),
      ]);

      const hasMore = offset + tasks.length < total;

      return {
        success: true,
        data: {
          tasks: tasks as TaskWithAsset[],
          total,
          hasMore,
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
        (task) => getFileType(task.assetObject.name) === "image",
      );
      const textTasks = recentTasks.filter((task) => getFileType(task.assetObject.name) === "text");
      const videoTasks = recentTasks.filter(
        (task) => getFileType(task.assetObject.name) === "video",
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
