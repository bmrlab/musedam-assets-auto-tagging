"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import {
  ASSET_TAGGING_CONCURRENCY,
  CANCELLED_TASK_ERROR_CODE,
  PROCESSING_TIMING_VERSION,
} from "@/app/(tagging)/queue-config";
import { ServerActionResult } from "@/lib/serverAction";
import { slugToId } from "@/lib/slug";
import { batchSyncAssetThumbnails } from "@/musedam/assets";
import {
  AssetObject,
  AssetObjectExtra,
  Prisma,
  TaggingQueueItem,
  TaggingQueueStatus,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { getTranslations } from "next-intl/server";
import {
  calculateAverageProcessingTimeSeconds,
  calculateEstimatedRemainingTimeSeconds,
  hasProcessingTimingVersion,
  RECENT_PROCESSING_TIME_SAMPLE_SIZE,
} from "./queue-timing";

export type DashboardStats = {
  totalCompleted: number;
  processing: number;
  pending: number;
  failed: number;
  totalAssets: number;
  monthlyCompleted: number;
  dailyCompleted: number;
  avgProcessingTime: number; // 平均处理时间（秒）
  estimatedRemainingTime: number; // 预计剩余时间（秒）
};

export type TaskWithAsset = Omit<TaggingQueueItem, "assetObject"> & {
  assetObject: Omit<AssetObject, "extra"> & {
    extra: AssetObjectExtra;
  };
};

// 控制面板只统计 / 展示正式打标任务：匹配测试页发起的 taskType=test 任务不进审核、不写回 MuseDAM，
// 也不应该混进统计数字与任务列表里。
const DASHBOARD_TASK_FILTER = { taskType: { not: "test" as const } };

// 取消任务落为 failed + result.error=CANCELLED，不需要数据库 migration。
// JSON path 缺失时比较结果是 NULL，因此要显式接纳 error 不存在的普通失败任务。
const FAILED_NOT_CANCELLED_FILTER: Prisma.TaggingQueueItemWhereInput = {
  status: "failed",
  OR: [
    { result: { path: ["error"], equals: Prisma.AnyNull } },
    { NOT: { result: { path: ["error"], equals: CANCELLED_TASK_ERROR_CODE } } },
  ],
};

const ALL_NOT_CANCELLED_FILTER: Prisma.TaggingQueueItemWhereInput = {
  OR: [
    { status: { not: "failed" } },
    {
      status: "failed",
      result: { path: ["error"], equals: Prisma.AnyNull },
    },
    {
      status: "failed",
      NOT: { result: { path: ["error"], equals: CANCELLED_TASK_ERROR_CODE } },
    },
  ],
};

// 原生聚合 SQL 用的时间参数：统一转成带时区的 ISO 字符串再显式 cast，
// 分桶边界仍在 JS 里按服务器本地时间计算，不依赖数据库会话时区。
// 整条 SQL 先用 Prisma.sql 拼好再传给 $queryRaw（而不是 $queryRaw`...` 标签模板里嵌套片段）：
// prisma 是全局单例，可能由另一个 bundle（如 instrumentation）创建，客户端按 instanceof 认不出
// 本模块的 Prisma.sql 片段，会把它当成 JSON 参数发出（报 operator does not exist: ... jsonb）。
const sqlTimestamp = (date: Date) => Prisma.sql`${date.toISOString()}::timestamptz`;

// 与 DASHBOARD_TASK_FILTER 对应的原生 SQL 条件
const SQL_DASHBOARD_TASK_FILTER = Prisma.sql`"taskType" <> 'test'`;

export async function fetchDashboardStats(): Promise<
  ServerActionResult<{
    stats: DashboardStats;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // 各状态计数与本月 / 今日完成数合并成一次扫描；failed 排除批量取消的任务
      // （result.error = CANCELLED，与 FAILED_NOT_CANCELLED_FILTER 一致）。
      const [[counts], totalAssets] = await Promise.all([
        prisma.$queryRaw<
          {
            totalCompleted: bigint;
            processing: bigint;
            pending: bigint;
            failed: bigint;
            monthlyCompleted: bigint;
            dailyCompleted: bigint;
          }[]
        >(
          Prisma.sql`
          SELECT
            count(*) FILTER (WHERE "status" = 'completed') AS "totalCompleted",
            count(*) FILTER (WHERE "status" = 'processing') AS "processing",
            count(*) FILTER (WHERE "status" = 'pending') AS "pending",
            count(*) FILTER (
              WHERE "status" = 'failed'
                AND ("result" ->> 'error') IS DISTINCT FROM ${CANCELLED_TASK_ERROR_CODE}
            ) AS "failed",
            count(*) FILTER (
              WHERE "status" = 'completed' AND "endsAt" >= ${sqlTimestamp(startOfMonth)}
            ) AS "monthlyCompleted",
            count(*) FILTER (
              WHERE "status" = 'completed' AND "endsAt" >= ${sqlTimestamp(startOfDay)}
            ) AS "dailyCompleted"
          FROM "TaggingQueueItem"
          WHERE "teamId" = ${teamId}
            AND ${SQL_DASHBOARD_TASK_FILTER}
            AND "assetObjectId" IS NOT NULL
        `,
        ),
        prisma.assetObject.count({
          where: { teamId },
        }),
      ]);
      const totalCompleted = Number(counts.totalCompleted);
      const processing = Number(counts.processing);
      const pending = Number(counts.pending);
      const failed = Number(counts.failed);
      const monthlyCompleted = Number(counts.monthlyCompleted);
      const dailyCompleted = Number(counts.dailyCompleted);

      // 使用最近完成的资产任务估算单项耗时。startsAt 在任务被 worker claim 时写入，
      // 因此这里只计算真正的处理时间，不包含 pending 队列中的等待时间。
      const recentCompletedTasks = await prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          ...DASHBOARD_TASK_FILTER,
          assetObjectId: { not: null },
          status: "completed",
          startsAt: { not: null },
          endsAt: { not: null },
        },
        orderBy: { endsAt: "desc" },
        take: RECENT_PROCESSING_TIME_SAMPLE_SIZE,
        select: {
          startsAt: true,
          endsAt: true,
          extra: true,
        },
      });

      const correctlyTimedTasks = recentCompletedTasks.filter((task) =>
        hasProcessingTimingVersion(task.extra, PROCESSING_TIMING_VERSION),
      );
      const avgProcessingTime = calculateAverageProcessingTimeSeconds(correctlyTimedTasks);
      const estimatedRemainingTime = calculateEstimatedRemainingTimeSeconds({
        averageProcessingTimeSeconds: avgProcessingTime,
        pending,
        processing,
        concurrency: ASSET_TAGGING_CONCURRENCY,
      });

      const stats: DashboardStats = {
        totalCompleted,
        processing,
        pending,
        failed,
        totalAssets,
        monthlyCompleted,
        dailyCompleted,
        avgProcessingTime,
        estimatedRemainingTime,
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

export type DashboardTaskFilter = "all" | "processing" | "failed";

export async function fetchProcessingTasks(
  page: number = 1,
  limit: number = 20,
  filter: DashboardTaskFilter = "all",
  search: string = "",
): Promise<
  ServerActionResult<{
    tasks: TaskWithAsset[];
    total: number;
    hasMore: boolean;
    page: number;
    limit: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId, slug: teamSlug } }) => {
    try {
      const offset = (page - 1) * limit;

      const statusFilter: Prisma.TaggingQueueItemWhereInput =
        filter === "processing"
          ? { status: { in: ["processing", "pending"] as TaggingQueueStatus[] } }
          : filter === "failed"
            ? FAILED_NOT_CANCELLED_FILTER
            : ALL_NOT_CANCELLED_FILTER;
      const keyword = search.trim();
      const whereClause: Prisma.TaggingQueueItemWhereInput = {
        teamId,
        ...DASHBOARD_TASK_FILTER,
        ...statusFilter,
        // 按素材名称模糊搜索（不区分大小写）；assetObject 为空的任务本来就不展示
        assetObject: keyword
          ? { is: { name: { contains: keyword, mode: "insensitive" } } }
          : { isNot: null },
      };

      const [tasks, total] = await Promise.all([
        prisma.taggingQueueItem.findMany({
          where: whereClause,
          include: {
            assetObject: true,
          },
          orderBy: [
            // { status: "asc" }, // processing 优先 ? 不用这样
            // { createdAt: "desc" },
            { id: "desc" },
          ],
          skip: offset,
          take: limit,
        }),
        prisma.taggingQueueItem.count({
          where: whereClause,
        }),
      ]);

      // 批量同步资产缩略图URL（防止签名过期）
      const team = { id: teamId, slug: teamSlug };
      const musedamAssetIds = tasks
        .map((task) => {
          if (!task.assetObject) return null;
          try {
            return slugToId("assetObject", task.assetObject.slug);
          } catch {
            return null;
          }
        })
        .filter((id): id is NonNullable<typeof id> => id !== null);

      if (musedamAssetIds.length > 0) {
        await batchSyncAssetThumbnails({
          musedamAssetIds,
          team,
        }).catch((error) => {
          // 同步失败不影响主流程，只记录错误
          console.error("批量同步资产缩略图失败:", error);
        });
      }

      // 重新查询更新后的任务列表，保持原有顺序
      const taskIds = tasks.map((t) => t.id);
      const updatedTasksMap = new Map(
        (
          await prisma.taggingQueueItem.findMany({
            where: {
              id: { in: taskIds },
            },
            include: {
              assetObject: true,
            },
          })
        ).map((task) => [task.id, task]),
      );

      // 按照原来的顺序重新组装任务列表
      const updatedTasks = taskIds
        .map((id) => updatedTasksMap.get(id))
        .filter((task): task is NonNullable<typeof task> => task !== undefined);

      const hasMore = offset + tasks.length < total;

      return {
        success: true,
        data: {
          tasks: updatedTasks as TaskWithAsset[],
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
          ...DASHBOARD_TASK_FILTER,
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
        where: { id: taskId, teamId, ...DASHBOARD_TASK_FILTER, status: "failed" },
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
        where: { teamId, ...DASHBOARD_TASK_FILTER, ...FAILED_NOT_CANCELLED_FILTER },
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
      const t = await getTranslations("Tagging.Dashboard");
      const today = new Date();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const dayNames = [
        t("dayNames.0"),
        t("dayNames.1"),
        t("dayNames.2"),
        t("dayNames.3"),
        t("dayNames.4"),
        t("dayNames.5"),
        t("dayNames.6"),
      ];
      // 分桶边界按服务器本地时间在 JS 里算好，SQL 只做一次扫描、每个桶一个 FILTER 计数，
      // 不再把 7 天内完成的任务全部拉回来逐条比较。
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekAgo);
        date.setDate(weekAgo.getDate() + i);
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);
        return { date, dayStart, dayEnd };
      });

      const [row] = await prisma.$queryRaw<Record<string, bigint>[]>(
        Prisma.sql`
        SELECT ${Prisma.join(
          days.map(
            ({ dayStart, dayEnd }, i) =>
              Prisma.sql`count(*) FILTER (
                WHERE "endsAt" >= ${sqlTimestamp(dayStart)} AND "endsAt" <= ${sqlTimestamp(dayEnd)}
              ) AS ${Prisma.raw(`"d${i}"`)}`,
          ),
        )}
        FROM "TaggingQueueItem"
        WHERE "teamId" = ${teamId}
          AND ${SQL_DASHBOARD_TASK_FILTER}
          AND "status" = 'completed'
          AND "endsAt" >= ${sqlTimestamp(weekAgo)}
          AND "endsAt" <= ${sqlTimestamp(today)}
      `,
      );

      const data = days.map(({ date }, i) => ({
        day: dayNames[date.getDay()],
        count: Number(row?.[`d${i}`] ?? 0),
      }));

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
          ...DASHBOARD_TASK_FILTER,
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
      const t = await getTranslations("Tagging.Dashboard");
      const monthNames = [
        t("monthNames.0"),
        t("monthNames.1"),
        t("monthNames.2"),
        t("monthNames.3"),
        t("monthNames.4"),
        t("monthNames.5"),
        t("monthNames.6"),
        t("monthNames.7"),
        t("monthNames.8"),
        t("monthNames.9"),
        t("monthNames.10"),
        t("monthNames.11"),
      ];

      // 12 个月的边界沿用原来按服务器本地时间的算法，SQL 一次扫描、每月两个 FILTER 计数，
      // 替代原来 12 轮串行 × 2 个 count。
      const buckets = Array.from({ length: 12 }, (_, index) => {
        const i = 11 - index;
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        return { date, monthStart, monthEnd };
      });
      const rangeStart = new Date(
        Math.min(...buckets.map(({ monthStart }) => monthStart.getTime())),
      );

      const [row] = await prisma.$queryRaw<Record<string, bigint>[]>(
        Prisma.sql`
        SELECT ${Prisma.join(
          buckets.flatMap(({ monthStart, monthEnd }, i) => [
            Prisma.sql`count(*) FILTER (
              WHERE "status" = 'completed'
                AND "endsAt" >= ${sqlTimestamp(monthStart)}
                AND "endsAt" <= ${sqlTimestamp(monthEnd)}
            ) AS ${Prisma.raw(`"c${i}"`)}`,
            Prisma.sql`count(*) FILTER (
              WHERE "createdAt" >= ${sqlTimestamp(monthStart)}
                AND "createdAt" <= ${sqlTimestamp(monthEnd)}
            ) AS ${Prisma.raw(`"t${i}"`)}`,
          ]),
        )}
        FROM "TaggingQueueItem"
        WHERE "teamId" = ${teamId}
          AND ${SQL_DASHBOARD_TASK_FILTER}
          AND (
            "createdAt" >= ${sqlTimestamp(rangeStart)}
            OR ("status" = 'completed' AND "endsAt" >= ${sqlTimestamp(rangeStart)})
          )
      `,
      );

      const months = buckets.map(({ date }, i) => ({
        month: monthNames[date.getMonth()],
        completed: Number(row?.[`c${i}`] ?? 0),
        total: Number(row?.[`t${i}`] ?? 0),
      }));

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
