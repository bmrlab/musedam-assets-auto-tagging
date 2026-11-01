import "server-only";

import { rootLogger } from "@/lib/logging";
import { getCachedSignedS3ObjectUrl, headS3Object } from "@/lib/s3";
import { IMAGE_FETCH_TIMEOUT_MS } from "@/lib/tagging/external-timeouts";
import {
  getReferenceThumbnailKey,
  uploadReferenceThumbnail,
} from "@/lib/tagging/reference-thumbnail";
import prisma from "@/prisma/prisma";

// 已有参考图的缩略图在队列进程里后台慢慢补：生产镜像（Next standalone）里没有 scripts/ 和 tsx，
// 回填脚本没法在 pod 里跑。每轮每个库只处理一小批、逐张串行，已有缩略图的只做一次 HEAD，
// 全部补完后停止；进程重启会从头再扫一遍（已存在的直接跳过，成本很低）。
const BATCH_SIZE = Number(process.env.THUMBNAIL_BACKFILL_BATCH_SIZE ?? 20);
const INTERVAL_MS = Number(process.env.THUMBNAIL_BACKFILL_INTERVAL_MS ?? 60_000);
const START_DELAY_MS = 120_000;
// 先补这些团队（本库内部 teamId，逗号分隔），补完再扫其余团队。
// TEMP(2026-09-30): 默认先补 933（特征库列表最慢的团队），部署侧可用环境变量覆盖，设为空字符串即不优先。
const PRIORITY_TEAM_IDS = (process.env.THUMBNAIL_BACKFILL_PRIORITY_TEAM_IDS ?? "933")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isInteger(id) && id > 0);

type ImageRow = { id: string; objectKey: string };
type TeamScope = { teamId: { in: number[] } } | { teamId: { notIn: number[] } } | undefined;
type Library = {
  name: string;
  load: (scope: TeamScope, afterId: string | null) => Promise<ImageRow[]>;
  count: (scope: TeamScope) => Promise<number>;
};

const s3Source = { OR: [{ source: "s3" }, { source: null }] };
const page = (afterId: string | null) => ({
  ...(afterId ? { id: { gt: afterId } } : {}),
});
const pageArgs = {
  orderBy: { id: "asc" as const },
  take: BATCH_SIZE,
  select: { id: true, objectKey: true },
};

const libraries: Library[] = [
  {
    name: "brand",
    load: (scope, afterId) =>
      prisma.assetLogoImage.findMany({
        where: { ...s3Source, ...(scope ? { assetLogo: scope } : {}), ...page(afterId) },
        ...pageArgs,
      }),
    count: (scope) =>
      prisma.assetLogoImage.count({
        where: { ...s3Source, ...(scope ? { assetLogo: scope } : {}) },
      }),
  },
  {
    name: "ip",
    load: (scope, afterId) =>
      prisma.assetIpImage.findMany({
        where: { ...s3Source, ...(scope ? { assetIp: scope } : {}), ...page(afterId) },
        ...pageArgs,
      }),
    count: (scope) =>
      prisma.assetIpImage.count({ where: { ...s3Source, ...(scope ? { assetIp: scope } : {}) } }),
  },
  {
    name: "product",
    load: (scope, afterId) =>
      prisma.assetProductImage.findMany({
        where: { ...s3Source, ...(scope ? { assetProduct: scope } : {}), ...page(afterId) },
        ...pageArgs,
      }),
    count: (scope) =>
      prisma.assetProductImage.count({
        where: { ...s3Source, ...(scope ? { assetProduct: scope } : {}) },
      }),
  },
  {
    name: "person",
    load: (scope, afterId) =>
      prisma.assetPersonImage.findMany({
        where: { ...s3Source, ...(scope ? { assetPerson: scope } : {}), ...page(afterId) },
        ...pageArgs,
      }),
    count: (scope) =>
      prisma.assetPersonImage.count({
        where: { ...s3Source, ...(scope ? { assetPerson: scope } : {}) },
      }),
  },
];

// 两个阶段：优先团队 → 其余团队（没有优先团队时只有一个"全部"阶段）
const phases: { name: string; scope: TeamScope }[] =
  PRIORITY_TEAM_IDS.length > 0
    ? [
        {
          name: `priority teams ${PRIORITY_TEAM_IDS.join(",")}`,
          scope: { teamId: { in: PRIORITY_TEAM_IDS } },
        },
        { name: "other teams", scope: { teamId: { notIn: PRIORITY_TEAM_IDS } } },
      ]
    : [{ name: "all teams", scope: undefined }];

async function ensureThumbnail(objectKey: string): Promise<boolean> {
  if (await headS3Object(getReferenceThumbnailKey(objectKey))) return false;
  const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
  const response = await fetch(signedUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to download reference image (${response.status})`);
  await uploadReferenceThumbnail(objectKey, Buffer.from(await response.arrayBuffer()));
  return true;
}

type Progress = { total: number; scanned: number; generated: number; failed: number };

export function startReferenceThumbnailBackfill() {
  const logger = rootLogger.child({ service: "thumbnail-backfill" });
  let phaseIndex = 0;
  let cursors = new Map<string, string | null>();
  let finished = new Set<string>();
  let progress = new Map<string, Progress>();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startPhase = async () => {
    const phase = phases[phaseIndex];
    cursors = new Map(libraries.map(({ name }) => [name, null]));
    finished = new Set();
    progress = new Map(
      await Promise.all(
        libraries.map(
          async ({ name, count }) =>
            [
              name,
              { total: await count(phase.scope), scanned: 0, generated: 0, failed: 0 },
            ] as const,
        ),
      ),
    );
    logger.info({
      msg: "Thumbnail backfill phase started",
      phase: phase.name,
      totals: Object.fromEntries([...progress].map(([name, p]) => [name, p.total])),
    });
  };

  const tick = async () => {
    if (running || phaseIndex >= phases.length) return;
    running = true;
    try {
      if (progress.size === 0) await startPhase();
      const phase = phases[phaseIndex];
      for (const library of libraries) {
        if (finished.has(library.name)) continue;
        const stats = progress.get(library.name)!;
        const rows = await library.load(phase.scope, cursors.get(library.name) ?? null);
        for (const row of rows) {
          try {
            if (await ensureThumbnail(row.objectKey)) stats.generated += 1;
          } catch (error) {
            stats.failed += 1;
            logger.warn({
              msg: "Thumbnail backfill failed",
              library: library.name,
              id: row.id,
              err: error,
            });
          }
        }
        stats.scanned += rows.length;
        if (rows.length > 0) cursors.set(library.name, rows[rows.length - 1].id);
        if (rows.length < BATCH_SIZE) finished.add(library.name);
      }
      // 每轮都打一条进度：scanned/total 即完成度，generated 是新补的，failed 是失败的
      logger.info({
        msg: "Thumbnail backfill progress",
        phase: phase.name,
        ...Object.fromEntries(
          [...progress].map(([name, p]) => [
            name,
            `${p.scanned}/${p.total} generated=${p.generated} failed=${p.failed}`,
          ]),
        ),
      });

      if (finished.size === libraries.length) {
        logger.info({ msg: "Thumbnail backfill phase completed", phase: phase.name });
        phaseIndex += 1;
        progress = new Map();
        if (phaseIndex >= phases.length && timer) {
          clearInterval(timer);
          logger.info({ msg: "Thumbnail backfill completed" });
        }
      }
    } catch (error) {
      logger.error({ msg: "Thumbnail backfill tick failed", err: error });
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    timer = setInterval(() => void tick(), INTERVAL_MS);
    timer.unref();
    void tick();
  }, START_DELAY_MS).unref();
}
