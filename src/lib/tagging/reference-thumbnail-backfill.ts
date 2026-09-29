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

type ImageRow = { id: string; objectKey: string };
const s3Source = { OR: [{ source: "s3" }, { source: null }] };
const libraries: { name: string; load: (afterId: string | null) => Promise<ImageRow[]> }[] = [
  {
    name: "brand",
    load: (afterId) =>
      prisma.assetLogoImage.findMany({
        where: { ...s3Source, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: { id: true, objectKey: true },
      }),
  },
  {
    name: "ip",
    load: (afterId) =>
      prisma.assetIpImage.findMany({
        where: { ...s3Source, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: { id: true, objectKey: true },
      }),
  },
  {
    name: "product",
    load: (afterId) =>
      prisma.assetProductImage.findMany({
        where: { ...s3Source, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: { id: true, objectKey: true },
      }),
  },
  {
    name: "person",
    load: (afterId) =>
      prisma.assetPersonImage.findMany({
        where: { ...s3Source, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: { id: true, objectKey: true },
      }),
  },
];

async function ensureThumbnail(objectKey: string): Promise<boolean> {
  if (await headS3Object(getReferenceThumbnailKey(objectKey))) return false;
  const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
  const response = await fetch(signedUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to download reference image (${response.status})`);
  await uploadReferenceThumbnail(objectKey, Buffer.from(await response.arrayBuffer()));
  return true;
}

export function startReferenceThumbnailBackfill() {
  const logger = rootLogger.child({ service: "thumbnail-backfill" });
  const cursors = new Map<string, string | null>(libraries.map(({ name }) => [name, null]));
  const finished = new Set<string>();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const library of libraries) {
        if (finished.has(library.name)) continue;
        const rows = await library.load(cursors.get(library.name) ?? null);
        let generated = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            if (await ensureThumbnail(row.objectKey)) generated += 1;
          } catch (error) {
            failed += 1;
            logger.warn({
              msg: "Thumbnail backfill failed",
              library: library.name,
              id: row.id,
              err: error,
            });
          }
        }
        if (rows.length > 0) cursors.set(library.name, rows[rows.length - 1].id);
        if (rows.length < BATCH_SIZE) finished.add(library.name);
        if (generated > 0 || failed > 0) {
          logger.info({
            msg: "Thumbnail backfill batch",
            library: library.name,
            generated,
            failed,
          });
        }
      }
      if (finished.size === libraries.length && timer) {
        clearInterval(timer);
        logger.info({ msg: "Thumbnail backfill completed" });
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
