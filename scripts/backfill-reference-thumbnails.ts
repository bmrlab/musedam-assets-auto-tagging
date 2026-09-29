// #!/usr/bin/env tsx
//
// 特征库参考图缩略图回填：给已有的参考图（品牌 / IP / 商品 / 人物）补生成长边 256 的缩略图，
// 存到 <objectKey>.thumb.jpg（规则见 src/lib/tagging/reference-thumbnail.ts）。
// 新上传 / 重新处理的参考图会在向量处理时自动生成，这个脚本只用于补历史数据。
//
// 用法（lib 依赖 server-only，需要带 react-server 条件运行）：
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/backfill-reference-thumbnails.ts \
//     [--team=<teamId>] [--dry-run] [--force] [--concurrency=3]
//
//   --team         只处理某个团队（AssetLogo.teamId 等，数字 id）
//   --dry-run      只统计需要生成的数量，不下载、不上传
//   --force        不做 HEAD 检查，全部重新生成覆盖
//   --concurrency  并发数，默认 3
//
// 幂等：默认先 HEAD 缩略图，已存在就跳过（一次 HEAD 比下载原图便宜得多），失败的重跑同一命令即可补上。

import { PrismaClient } from "@/prisma/client";
import { loadEnvConfig } from "@next/env";
import pLimit from "p-limit";

type ReferenceImageRow = { library: string; teamId: number; objectKey: string };

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) =>
    args
      .find((a) => a.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
  const team = get("team");
  const concurrency = Number(get("concurrency") ?? 3);
  if (team !== undefined && !/^\d+$/.test(team)) throw new Error("--team 需要数字 teamId");
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("--concurrency 需要正整数");
  return {
    teamId: team === undefined ? undefined : Number(team),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    concurrency,
  };
}

async function loadReferenceImages(prisma: PrismaClient, teamId: number | undefined) {
  const s3Source = { OR: [{ source: "s3" }, { source: null }] };
  const [logos, ips, products, persons] = await Promise.all([
    prisma.assetLogoImage.findMany({
      where: { ...s3Source, ...(teamId ? { assetLogo: { teamId } } : {}) },
      select: { objectKey: true, assetLogo: { select: { teamId: true } } },
    }),
    prisma.assetIpImage.findMany({
      where: { ...s3Source, ...(teamId ? { assetIp: { teamId } } : {}) },
      select: { objectKey: true, assetIp: { select: { teamId: true } } },
    }),
    prisma.assetProductImage.findMany({
      where: { ...s3Source, ...(teamId ? { assetProduct: { teamId } } : {}) },
      select: { objectKey: true, assetProduct: { select: { teamId: true } } },
    }),
    prisma.assetPersonImage.findMany({
      where: { ...s3Source, ...(teamId ? { assetPerson: { teamId } } : {}) },
      select: { objectKey: true, assetPerson: { select: { teamId: true } } },
    }),
  ]);
  const rows: ReferenceImageRow[] = [
    ...logos.map((r) => ({ library: "brand", teamId: r.assetLogo.teamId, objectKey: r.objectKey })),
    ...ips.map((r) => ({ library: "ip", teamId: r.assetIp.teamId, objectKey: r.objectKey })),
    ...products.map((r) => ({
      library: "product",
      teamId: r.assetProduct.teamId,
      objectKey: r.objectKey,
    })),
    ...persons.map((r) => ({
      library: "person",
      teamId: r.assetPerson.teamId,
      objectKey: r.objectKey,
    })),
  ];
  return rows;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { teamId, dryRun, force, concurrency } = parseArgs();
  // 环境变量加载之后再引入依赖 S3 配置的模块
  const { getCachedSignedS3ObjectUrl, headS3Object } = await import("@/lib/s3");
  const { getReferenceThumbnailKey, uploadReferenceThumbnail } = await import(
    "@/lib/tagging/reference-thumbnail"
  );

  const prisma = new PrismaClient();
  try {
    const images = await loadReferenceImages(prisma, teamId);
    console.log(
      `共 ${images.length} 张参考图${teamId ? `（团队 ${teamId}）` : ""}，并发 ${concurrency}${dryRun ? "，dry-run" : ""}${force ? "，force" : ""}`,
    );

    const limit = pLimit(concurrency);
    let done = 0;
    let generated = 0;
    let skipped = 0;
    const failures: { objectKey: string; error: string }[] = [];
    const logProgress = () => {
      if (done % 50 === 0 || done === images.length) {
        console.log(
          `进度 ${done}/${images.length}：生成 ${generated}，已存在跳过 ${skipped}，失败 ${failures.length}`,
        );
      }
    };

    await Promise.all(
      images.map((image) =>
        limit(async () => {
          try {
            if (!force && (await headS3Object(getReferenceThumbnailKey(image.objectKey)))) {
              skipped += 1;
              return;
            }
            if (dryRun) {
              generated += 1;
              return;
            }
            const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey: image.objectKey });
            const response = await fetch(signedUrl, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok) throw new Error(`下载原图失败 (${response.status})`);
            await uploadReferenceThumbnail(
              image.objectKey,
              Buffer.from(await response.arrayBuffer()),
            );
            generated += 1;
          } catch (error) {
            failures.push({
              objectKey: image.objectKey,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            done += 1;
            logProgress();
          }
        }),
      ),
    );

    console.log(
      `完成：${dryRun ? "需要生成" : "生成"} ${generated}，已存在跳过 ${skipped}，失败 ${failures.length}`,
    );
    for (const failure of failures.slice(0, 50)) {
      console.log(`  失败 ${failure.objectKey}: ${failure.error}`);
    }
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
