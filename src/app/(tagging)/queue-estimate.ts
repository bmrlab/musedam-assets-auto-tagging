import { PROCESSING_TIMING_VERSION } from "@/app/(tagging)/queue-config";
import { queueLaneConcurrency } from "@/app/(tagging)/queue-schedule";
import {
  calculateAverageProcessingTimeSeconds,
  hasProcessingTimingVersion,
  RECENT_PROCESSING_TIME_SAMPLE_SIZE,
} from "@/app/(tagging)/tagging/dashboard/queue-timing";
import type { TaggingTaskType } from "@/prisma/client";
import prisma from "@/prisma/prisma";

// 没有历史样本时（新团队 / 首次打标）的兜底单条耗时
const FALLBACK_PROCESSING_SECONDS = 40;
// 队列由外部调度器周期性触发（README: 10s，私有化部署: 30s），排队的任务至少要等下一轮调度
const WORKER_POLL_INTERVAL_SECONDS = Number(process.env.QUEUE_WORKER_POLL_INTERVAL_SECONDS ?? 15);

export type QueueWaitEstimate = {
  /** 同车道里比本任务更早入队、仍在排队的素材打标任务数。测试只数测试，正式不数测试。 */
  aheadCount: number;
  /** 全局正在处理中的素材打标任务数。测试页用它判断 worker 是否在跑，所以不按车道拆开。 */
  processingCount: number;
  /** 本团队最近完成任务的平均耗时（秒），0 表示无样本 */
  avgProcessingSeconds: number;
  /** 预计还需等待的秒数（含排队 + 自身处理） */
  estimatedWaitSeconds: number;
};

/**
 * 为一条 pending / processing 的打标任务估算等待时长。
 * 测试和正式分车道领取，排队位置只数本车道；另一条车道正在排队或处理时，本车道只用自己的槽位。
 * 平均耗时用本团队最近完成的样本，更贴近该团队的素材类型与开启的特征库能力。
 */
export async function getQueueWaitEstimate({
  teamId,
  queueItemId,
  createdAt,
  status,
  taskType,
}: {
  teamId: number;
  queueItemId: number;
  createdAt: Date;
  status: "pending" | "processing";
  taskType: TaggingTaskType;
}): Promise<QueueWaitEstimate> {
  const isTest = taskType === "test";
  const sameLane = isTest ? { taskType: "test" as const } : { taskType: { not: "test" as const } };
  const otherLane = isTest ? { taskType: { not: "test" as const } } : { taskType: "test" as const };
  const [aheadCount, processingCount, otherLanePending, otherLaneProcessing, recentCompletedTasks] =
    await Promise.all([
      status === "pending"
        ? prisma.taggingQueueItem.count({
            where: {
              status: "pending",
              assetObjectId: { not: null },
              id: { not: queueItemId },
              createdAt: { lte: createdAt },
              ...sameLane,
            },
          })
        : Promise.resolve(0),
      prisma.taggingQueueItem.count({
        where: { status: "processing", assetObjectId: { not: null } },
      }),
      prisma.taggingQueueItem.count({
        where: { status: "pending", assetObjectId: { not: null }, ...otherLane },
      }),
      prisma.taggingQueueItem.count({
        where: { status: "processing", assetObjectId: { not: null }, ...otherLane },
      }),
      prisma.taggingQueueItem.findMany({
        where: {
          teamId,
          assetObjectId: { not: null },
          status: "completed",
          startsAt: { not: null },
          endsAt: { not: null },
        },
        orderBy: { endsAt: "desc" },
        take: RECENT_PROCESSING_TIME_SAMPLE_SIZE,
        select: { startsAt: true, endsAt: true, extra: true },
      }),
    ]);

  const sampledAvg = calculateAverageProcessingTimeSeconds(
    recentCompletedTasks.filter((task) =>
      hasProcessingTimingVersion(task.extra, PROCESSING_TIMING_VERSION),
    ),
  );
  const avgProcessingSeconds = sampledAvg > 0 ? sampledAvg : FALLBACK_PROCESSING_SECONDS;

  let estimatedWaitSeconds: number;
  if (status === "processing") {
    estimatedWaitSeconds = avgProcessingSeconds;
  } else {
    // 前面 aheadCount 个同车道任务 + 自己，按本车道槽位轮转；再加一轮调度间隔
    const laneConcurrency = queueLaneConcurrency(
      isTest ? "test" : "production",
      otherLanePending > 0 || otherLaneProcessing > 0,
    );
    const rounds = Math.ceil((aheadCount + 1) / Math.max(1, laneConcurrency));
    estimatedWaitSeconds = rounds * avgProcessingSeconds + WORKER_POLL_INTERVAL_SECONDS;
  }

  return {
    aheadCount,
    processingCount,
    avgProcessingSeconds: sampledAvg,
    estimatedWaitSeconds,
  };
}
