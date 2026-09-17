// 单租户私有化迁移 —— 导出核心逻辑。
// 被两处共用：
//   - scripts/migrate-team-export.ts（在能连 SaaS 库的机器上跑，落成目录）
//   - GET /api/tagging/migration/export（生产应用内直接调用，返回一个 JSON 包）
// 这里不依赖 Next / "server-only"，只依赖 Prisma client 和一个可选的签名函数。

import type { PrismaClient } from "@/prisma/client";

export const MIGRATION_BUNDLE_VERSION = 1;
// AWS 预签名链接最长 7 天
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export type MigrationAsset = {
  model: string;
  id: string;
  objectKey: string;
  mimeType: string;
  sourceUrl?: string;
};

export type MigrationManifest = {
  version: number;
  teamId: number;
  teamSlug: string;
  teamName: string;
  exportedAt: string;
  imageCount: number;
  signedUrlExpiresAt: string | null;
};

export type MigrationBundle = {
  manifest: MigrationManifest;
  assets: MigrationAsset[];
  // key 与导入脚本读取的 db/<key>.json 一一对应
  db: Record<string, unknown[]>;
};

export type PresignFn = (objectKey: string, expiresInSeconds: number) => { url: string; expiresAt: string };

export function musedamTeamIdToSlug(raw: string) {
  // 与 src/lib/slug.ts 的 idToSlug("team", id) 一致：t/<musedamTeamId>；允许直接传 "t/xxx"
  const bare = raw.replace(/^t\//, "").trim();
  if (!bare) throw new Error(`musedam team id 不合法: ${raw}`);
  return `t/${bare}`;
}

export async function exportTeamBundle(
  prisma: PrismaClient,
  where: { teamId: number } | { teamSlug: string },
  opts: { presign?: PresignFn; presignExpires?: number; log?: (msg: string) => void } = {},
): Promise<MigrationBundle> {
  const log = opts.log ?? (() => {});
  const presignExpires = Math.min(opts.presignExpires ?? MAX_PRESIGN_SECONDS, MAX_PRESIGN_SECONDS);

  const team =
    "teamSlug" in where
      ? await prisma.team.findUnique({ where: { slug: where.teamSlug } })
      : await prisma.team.findUnique({ where: { id: where.teamId } });
  if (!team) {
    throw new Error(
      "teamSlug" in where ? `源库中不存在 slug=${where.teamSlug} 的团队` : `源库中不存在 teamId=${where.teamId}`,
    );
  }
  const teamId = team.id;
  log(`=== 导出 Team #${teamId} (slug=${team.slug}, name=${team.name}) ===`);

  const db: Record<string, unknown[]> = {};
  db.team = [team];
  db.teamConfig = await prisma.teamConfig.findMany({ where: { teamId } });
  db.assetTag = await prisma.assetTag.findMany({ where: { teamId }, orderBy: { id: "asc" } });
  db.assetObject = await prisma.assetObject.findMany({ where: { teamId } });

  const kinds = [
    { kind: "assetLogo", typeModel: "assetLogoType", imageModel: "assetLogoImage", tagModel: "assetLogoTag" },
    { kind: "assetIp", typeModel: "assetIpType", imageModel: "assetIpImage", tagModel: "assetIpTag" },
    { kind: "assetProduct", typeModel: "assetProductType", imageModel: "assetProductImage", tagModel: "assetProductTag" },
    { kind: "assetPerson", typeModel: "assetPersonType", imageModel: "assetPersonImage", tagModel: "assetPersonTag" },
  ] as const;

  // 图片清单：导入脚本据此下载并上传，再回写 objectKey
  const assets: MigrationAsset[] = [];

  for (const { kind, typeModel, imageModel, tagModel } of kinds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 四类资产结构一致，动态取 model
    const src = prisma as any;

    db[typeModel] = await src[typeModel].findMany({ where: { teamId } });
    const entities: { id: string }[] = await src[kind].findMany({ where: { teamId } });
    db[kind] = entities;

    const entityIds = entities.map((e) => e.id);
    const images: { id: string; objectKey: string; mimeType: string }[] = entityIds.length
      ? await src[imageModel].findMany({ where: { [`${kind}Id`]: { in: entityIds } } })
      : [];
    db[imageModel] = images;
    for (const img of images) {
      assets.push({ model: imageModel, id: img.id, objectKey: img.objectKey, mimeType: img.mimeType });
    }

    db[tagModel] = entityIds.length ? await src[tagModel].findMany({ where: { [`${kind}Id`]: { in: entityIds } } }) : [];
  }

  // pgvector 表：Unsupported("vector(...)") 字段不在 Prisma Client API 里，走原生 SQL。
  // 不能 SELECT *（Prisma 反序列化不了 vector 列），改用 to_jsonb 把整行转成 JSON 再去掉 embedding，
  // embedding 单独转成文本（导入时再 cast 回 vector），这样纯 JSON 就能带着走。
  for (const table of ["LogoVector", "IpVector", "ProductVector", "PersonVector"]) {
    const rows = await prisma.$queryRawUnsafe<Array<{ row: Record<string, unknown>; embeddingText: string }>>(
      `SELECT (to_jsonb(t) - 'embedding') AS "row", t.embedding::text AS "embeddingText"
         FROM "${table}" t WHERE t."teamId" = $1`,
      teamId,
    );
    db[table] = rows.map(({ row, embeddingText }) => ({ ...row, embeddingText }));
  }

  db.taggingQueueItem = await prisma.taggingQueueItem.findMany({ where: { teamId } });
  db.taggingAuditItem = await prisma.taggingAuditItem.findMany({ where: { teamId } });

  let signedUrlExpiresAt: string | null = null;
  if (opts.presign) {
    for (const a of assets) {
      const signed = opts.presign(a.objectKey, presignExpires);
      a.sourceUrl = signed.url;
      signedUrlExpiresAt = signed.expiresAt;
    }
    log(`已为 ${assets.length} 张图片生成预签名下载链接，过期时间 ${signedUrlExpiresAt ?? "-"}`);
  } else {
    log("未生成签名链接，导入时需要 --source-url-base");
  }

  const rowCount = Object.values(db).reduce((n, rows) => n + rows.length, 0);
  log(`数据库导出完成：${Object.keys(db).length} 张表，${rowCount} 行，图片记录 ${assets.length} 条`);

  return {
    manifest: {
      version: MIGRATION_BUNDLE_VERSION,
      teamId,
      teamSlug: team.slug,
      teamName: team.name,
      exportedAt: new Date().toISOString(),
      imageCount: assets.length,
      signedUrlExpiresAt,
    },
    assets,
    db,
  };
}
