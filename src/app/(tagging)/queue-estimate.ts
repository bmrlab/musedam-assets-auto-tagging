import { ASSET_TAGGING_CONCURRENCY, PROCESSING_TIMING_VERSION } from "@/app/(tagging)/queue-config";
import {
  calculateAverageProcessingTimeSeconds,
  hasProcessingTimingVersion,
  RECENT_PROCESSING_TIME_SAMPLE_SIZE,
} from "@/app/(tagging)/tagging/dashboard/queue-timing";
import prisma from "@/prisma/prisma";

// 没有历史样本时（新团队 / 首次打标）的兜底单条耗时
const FALLBACK_PROCESSING_SECONDS = 40;
// 队列由外部调度器周期性触发（README: 10s，私有化部署: 30s），排队的任务至少要等下一轮调度
const WORKER_POLL_INTERVAL_SECONDS = Number(process.env.QUEUE_WORKER_POLL_INTERVAL_SECONDS ?? 15);

export type QueueWaitEstimate = {
  /** 全局比本任务更早入队、仍在排队的素材打标任务数 */
  aheadCount: number;
  /** 全局正在处理中的素材打标任务数 */
  processingCount: number;
  /** 本团队最近完成任务的平均耗时（秒），0 表示无样本 */
  avgProcessingSeconds: number;
  /** 预计还需等待的秒数（含排队 + 自身处理） */
  estimatedWaitSeconds: number;
};

/**
 * 为一条 pending / processing 的打标任务估算等待时长。
 * 队列是全局的（processPendingQueueItems 不分团队），所以排队位置按全局 pending 计算；
 * 平均耗时用本团队最近完成的样本，更贴近该团队的素材类型与开启的特征库能力。
 */
export async function getQueueWaitEstimate({
  teamId,
  queueItemId,
  createdAt,
  status,
}: {
  teamId: number;
  queueItemId: number;
  createdAt: Date;
  status: "pending" | "processing";
}): Promise<QueueWaitEstimate> {
  const [aheadCount, processingCount, recentCompletedTasks] = await Promise.all([
    status === "pending"
      ? prisma.taggingQueueItem.count({
          where: {
            status: "pending",
            assetObjectId: { not: null },
            id: { not: queueItemId },
            createdAt: { lte: createdAt },
          },
        })
      : Promise.resolve(0),
    prisma.taggingQueueItem.count({
      where: { status: "processing", assetObjectId: { not: null } },
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
    // 前面 aheadCount 个任务 + 自己，按并发槽位轮转；再加一轮调度间隔
    const rounds = Math.ceil((aheadCount + 1) / Math.max(1, ASSET_TAGGING_CONCURRENCY));
    estimatedWaitSeconds = rounds * avgProcessingSeconds + WORKER_POLL_INTERVAL_SECONDS;
  }

  return {
    aheadCount,
    processingCount,
    avgProcessingSeconds: sampledAvg,
    estimatedWaitSeconds,
  };
}
