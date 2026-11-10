import { PROCESSING_TIMING_VERSION } from "@/app/(tagging)/queue-config";
import { queueLaneConcurrency } from "@/app/(tagging)/queue-schedule";
import {
  calculateAverageProcessingTimeSeconds,
  hasProcessingTimingVersion,
  RECENT_PROCESSING_TIME_SAMPLE_SIZE,
} from "@/app/(tagging)/tagging/dashboard/queue-timing";
import { Prisma, type TaggingTaskType } from "@/prisma/client";
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
export type EstimatableQueueItem = {
  id: number;
  createdAt: Date;
  status: string;
  taskType: TaggingTaskType;
};

/** One snapshot per HTTP request; never one count/history query per visible task. */
export async function getQueueWaitEstimates(
  teamId: number,
  items: EstimatableQueueItem[],
): Promise<Map<number, QueueWaitEstimate>> {
  const active = items.filter((item) => item.status === "pending" || item.status === "processing");
  if (!active.length) return new Map();
  const pendingIds = active.filter((item) => item.status === "pending").map((item) => item.id);
  const [counts, ranks, recent] = await Promise.all([
    prisma.$queryRaw<
      Array<{ test: boolean; status: string; count: bigint }>
    >`SELECT ("taskType" = 'test') AS test,
      "status"::text AS status, count(*) AS count FROM "TaggingQueueItem"
      WHERE "status" IN ('pending', 'processing') AND "assetObjectId" IS NOT NULL GROUP BY 1, 2`,
    pendingIds.length
      ? prisma.$queryRaw<Array<{ id: number; ahead: bigint }>>(Prisma.sql`
      WITH ranked AS (SELECT "id", row_number() OVER (
        PARTITION BY ("taskType" = 'test') ORDER BY "createdAt", "id") - 1 AS ahead
        FROM "TaggingQueueItem" WHERE "status" = 'pending' AND "assetObjectId" IS NOT NULL
        AND "createdAt" <= ${new Date(Math.max(...active.filter((item) => item.status === "pending").map((item) => item.createdAt.getTime())))})
      SELECT "id", ahead FROM ranked WHERE "id" IN (${Prisma.join(pendingIds)})`)
      : [],
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
    recent.filter((task) => hasProcessingTimingVersion(task.extra, PROCESSING_TIMING_VERSION)),
  );
  const average = sampledAvg || FALLBACK_PROCESSING_SECONDS;
  const processingCount = counts
    .filter((row) => row.status === "processing")
    .reduce((sum, row) => sum + Number(row.count), 0);
  const aheadById = new Map(ranks.map((row) => [row.id, Number(row.ahead)]));
  return new Map(
    active.map((item) => {
      const test = item.taskType === "test";
      const otherLaneBusy = counts.some((row) => row.test !== test && Number(row.count) > 0);
      const aheadCount = aheadById.get(item.id) ?? 0;
      const concurrency = Math.max(
        1,
        queueLaneConcurrency(test ? "test" : "production", otherLaneBusy),
      );
      return [
        item.id,
        {
          aheadCount,
          processingCount,
          avgProcessingSeconds: sampledAvg,
          estimatedWaitSeconds:
            item.status === "processing"
              ? average
              : Math.ceil((aheadCount + 1) / concurrency) * average + WORKER_POLL_INTERVAL_SECONDS,
        },
      ];
    }),
  );
}

export async function getQueueWaitEstimate(input: {
  teamId: number;
  queueItemId: number;
  createdAt: Date;
  status: "pending" | "processing";
  taskType: TaggingTaskType;
}): Promise<QueueWaitEstimate> {
  return (await getQueueWaitEstimates(input.teamId, [{ id: input.queueItemId, ...input }])).get(
    input.queueItemId,
  )!;
}
