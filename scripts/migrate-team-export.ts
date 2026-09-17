// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 导出阶段。
//
// 运行位置：只需要能连上 SaaS 的数据库 + 持有 SaaS 桶的 AK/SK（我们自己的内网/VPN 环境），
//          完全不需要连客户私有化环境。
// 产出：一个本地目录（--out-dir，默认 ./migration-export/team-<id>）：
//   db/*.json      该 team 的数据库导出，表里的字段原样导出（图片表里的 objectKey 保持 SaaS 上的值）
//   assets.json    每张图片一条 { model, id, objectKey, mimeType, sourceUrl }，sourceUrl 是用 SaaS 凭证
//                  生成的预签名下载链接，默认 7 天有效（AWS 上限）。图片文件本身不导出。
//   manifest.json  团队信息、图片条数、签名链接过期时间
// 导入脚本在客户环境里按 assets.json 的 sourceUrl 下载 -> 上传到客户桶 -> update 数据库里的 objectKey，
// 客户环境不需要我们的 AK/SK，只需要能访问签名链接。
// 整个目录打包后通过客户认可的安全方式（scp 到堡垒机等）传进私有化环境，再用 scripts/migrate-team-import.ts 导入。
//
// 用法：
//   SOURCE_DATABASE_URL=postgres://...saas-db... \
//   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//   S3_ENDPOINT_URL=https://s3.<region>.amazonaws.com S3_REGION=<region> S3_BUCKET=<bucket> S3_FORCE_PATH_STYLE=false \
//   npx tsx scripts/migrate-team-export.ts --musedam-team-id=xxx [--out-dir=./migration-export/team-<id>]
//
// --musedam-team-id 填 MuseDAM 侧的团队 id（也可以直接填 "t/xxx"），脚本会按 slug 反查本项目的 Team.id。
// 如果已经知道本项目的 Team.id，也可以用 --team-id=<id> 直接指定，两者二选一。
// --presign-expires=<秒> 可改签名链接有效期，默认 604800（7 天）；--skip-presign 只导库不生成链接。

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@/prisma/client";
import { loadS3Config, MAX_PRESIGN_SECONDS, presignGetUrl, writeJsonFile } from "./lib/migrate-team-shared";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const has = (name: string) => args.includes(`--${name}`);

  const teamIdRaw = get("team-id");
  const musedamTeamIdRaw = get("musedam-team-id");
  if (!teamIdRaw && !musedamTeamIdRaw) {
    throw new Error("缺少参数：请提供 --musedam-team-id=<MuseDAM 团队 id> 或 --team-id=<本项目 Team.id>");
  }
  if (teamIdRaw && musedamTeamIdRaw) throw new Error("--team-id 和 --musedam-team-id 只能二选一");

  let teamId: number | undefined;
  if (teamIdRaw) {
    teamId = Number(teamIdRaw);
    if (!Number.isInteger(teamId) || teamId <= 0) throw new Error(`--team-id 不合法: ${teamIdRaw}`);
  }

  // slug 规则与 src/lib/slug.ts 的 idToSlug("team", id) 一致：t/<musedamTeamId>；允许直接传 "t/xxx"
  let teamSlug: string | undefined;
  if (musedamTeamIdRaw) {
    const bare = musedamTeamIdRaw.replace(/^t\//, "").trim();
    if (!bare) throw new Error(`--musedam-team-id 不合法: ${musedamTeamIdRaw}`);
    teamSlug = `t/${bare}`;
  }

  return {
    teamId,
    teamSlug,
    outDir: get("out-dir"),
    skipPresign: has("skip-presign"),
    presignExpires: Math.min(Number(get("presign-expires") || MAX_PRESIGN_SECONDS), MAX_PRESIGN_SECONDS),
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseArgs();

  const source = new PrismaClient({ datasourceUrl: process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL });

  try {
    const team = args.teamSlug
      ? await source.team.findUnique({ where: { slug: args.teamSlug } })
      : await source.team.findUnique({ where: { id: args.teamId! } });
    if (!team) {
      throw new Error(args.teamSlug ? `源库中不存在 slug=${args.teamSlug} 的团队` : `源库中不存在 teamId=${args.teamId}`);
    }
    const teamId = team.id;
    const outDir = args.outDir || `./migration-export/team-${teamId}`;

    console.log(`=== 导出 Team #${teamId} (slug=${team.slug}, name=${team.name}) -> ${outDir} ===`);
    await writeJsonFile(`${outDir}/db/team.json`, team);

    const teamConfigs = await source.teamConfig.findMany({ where: { teamId } });
    await writeJsonFile(`${outDir}/db/teamConfig.json`, teamConfigs);

    const assetTags = await source.assetTag.findMany({ where: { teamId }, orderBy: { id: "asc" } });
    await writeJsonFile(`${outDir}/db/assetTag.json`, assetTags);

    const assetObjects = await source.assetObject.findMany({ where: { teamId } });
    await writeJsonFile(`${outDir}/db/assetObject.json`, assetObjects);

    type Kind = "assetLogo" | "assetIp" | "assetProduct" | "assetPerson";
    const kinds: { kind: Kind; typeModel: string; imageModel: string; tagModel: string; fk: string }[] = [
      { kind: "assetLogo", typeModel: "assetLogoType", imageModel: "assetLogoImage", tagModel: "assetLogoTag", fk: "assetLogoId" },
      { kind: "assetIp", typeModel: "assetIpType", imageModel: "assetIpImage", tagModel: "assetIpTag", fk: "assetIpId" },
      { kind: "assetProduct", typeModel: "assetProductType", imageModel: "assetProductImage", tagModel: "assetProductTag", fk: "assetProductId" },
      { kind: "assetPerson", typeModel: "assetPersonType", imageModel: "assetPersonImage", tagModel: "assetPersonTag", fk: "assetPersonId" },
    ];

    // 图片清单：导入脚本据此下载并上传，再回写 objectKey
    const assets: { model: string; id: string; objectKey: string; mimeType: string; sourceUrl?: string }[] = [];

    for (const { kind, typeModel, imageModel, tagModel } of kinds) {
      // biome-ignore lint: 四类资产结构一致，动态取 model
      const src = source as any;

      const types = await src[typeModel].findMany({ where: { teamId } });
      await writeJsonFile(`${outDir}/db/${typeModel}.json`, types);

      const entities = await src[kind].findMany({ where: { teamId } });
      await writeJsonFile(`${outDir}/db/${kind}.json`, entities);

      const entityIds = entities.map((e: any) => e.id);
      const images = entityIds.length
        ? await src[imageModel].findMany({ where: { [`${kind}Id`]: { in: entityIds } } })
        : [];
      await writeJsonFile(`${outDir}/db/${imageModel}.json`, images);
      for (const img of images) {
        assets.push({ model: imageModel, id: img.id, objectKey: img.objectKey, mimeType: img.mimeType });
      }

      const tags = entityIds.length
        ? await src[tagModel].findMany({ where: { [`${kind}Id`]: { in: entityIds } } })
        : [];
      await writeJsonFile(`${outDir}/db/${tagModel}.json`, tags);
    }

    // pgvector 表：Unsupported("vector(...)") 字段不在 Prisma Client API 里，走原生 SQL。
    // 不能 SELECT *（Prisma 反序列化不了 vector 列），改用 to_jsonb 把整行转成 JSON 再去掉 embedding，
    // embedding 单独转成文本（导入时再 cast 回 vector），这样纯 JSON 就能带着走。
    for (const table of ["LogoVector", "IpVector", "ProductVector", "PersonVector"]) {
      const rows = await source.$queryRawUnsafe<Array<{ row: Record<string, unknown>; embeddingText: string }>>(
        `SELECT (to_jsonb(t) - 'embedding') AS "row", t.embedding::text AS "embeddingText"
           FROM "${table}" t WHERE t."teamId" = $1`,
        teamId,
      );
      await writeJsonFile(
        `${outDir}/db/${table}.json`,
        rows.map(({ row, embeddingText }) => ({ ...row, embeddingText })),
      );
    }

    const queueItems = await source.taggingQueueItem.findMany({ where: { teamId } });
    await writeJsonFile(`${outDir}/db/taggingQueueItem.json`, queueItems);

    const auditItems = await source.taggingAuditItem.findMany({ where: { teamId } });
    await writeJsonFile(`${outDir}/db/taggingAuditItem.json`, auditItems);

    let signedUrlExpiresAt: string | null = null;
    if (args.skipPresign) {
      console.log("已跳过生成签名链接（--skip-presign），导入时需要 --source-url-base");
    } else {
      // 只签名不请求，不需要网络；凭证错了要到导入阶段下载时才会暴露，所以导出后最好抽一条链接手动打开验证
      const sourceS3 = loadS3Config("", "SaaS S3");
      for (const a of assets) {
        const signed = presignGetUrl(sourceS3, a.objectKey, args.presignExpires);
        a.sourceUrl = signed.url;
        signedUrlExpiresAt = signed.expiresAt;
      }
      console.log(`已为 ${assets.length} 张图片生成预签名下载链接，过期时间 ${signedUrlExpiresAt ?? "-"}`);
      if (assets[0]?.sourceUrl) console.log(`  抽检链接（请手动打开确认可访问）: ${assets[0].sourceUrl}`);
    }
    await writeJsonFile(`${outDir}/assets.json`, assets);

    await writeJsonFile(`${outDir}/manifest.json`, {
      teamId,
      teamSlug: team.slug,
      exportedAt: new Date().toISOString(),
      imageCount: assets.length,
      signedUrlExpiresAt,
    });

    console.log(`数据库导出完成（图片记录 ${assets.length} 条，图片文件本身不导出，导入时按 assets.json 的链接拉取）`);
    console.log(`\n=== 导出完成，请把整个目录 ${outDir} 传进私有化环境后执行 migrate-team-import.ts ===`);
  } finally {
    await source.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ 导出失败:", err);
  process.exit(1);
});
