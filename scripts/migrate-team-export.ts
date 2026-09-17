// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 导出阶段。
//
// 运行位置：只需要能连上 SaaS 的 AWS RDS + AWS S3（我们自己的内网/VPN 环境），
//          完全不需要连客户私有化环境。
// 产出：一个本地目录（--out-dir，默认 ./migration-export/team-<id>），
//      里面是该 team 的数据库导出（db/*.json）+ 资源文件（assets/...），
//      整个目录打包后通过客户认可的安全方式（scp 到堡垒机等）传进私有化环境，
//      再用 scripts/migrate-team-import.ts 导入。
//
// 用法：
//   SOURCE_DATABASE_URL=postgres://...aws-rds.../saas_db \
//   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//   S3_ENDPOINT_URL=https://s3.us-east-1.amazonaws.com S3_REGION=us-east-1 \
//   S3_BUCKET=musedam-saas-assets S3_FOLDER= \
//   npx tsx scripts/migrate-team-export.ts --musedam-team-id=xxx [--out-dir=./migration-export/team-<id>] [--skip-assets]
//
// --musedam-team-id 填 MuseDAM 侧的团队 id（也可以直接填 "t/xxx"），脚本会按 slug 反查本项目的 Team.id。
// 如果已经知道本项目的 Team.id，也可以用 --team-id=<id> 直接指定，两者二选一。

import { loadEnvConfig } from "@next/env";
import { existsSync } from "fs";
import { PrismaClient } from "@/prisma/client";
import {
  assetLocalPath,
  loadS3Config,
  progressLogger,
  runWithConcurrency,
  s3Get,
  writeBinaryFile,
  writeJsonFile,
} from "./lib/migrate-team-shared";

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
    skipAssets: has("skip-assets"),
    concurrency: Number(get("resource-concurrency") || "8"),
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
    const { skipAssets, concurrency } = args;

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

    const allImageRows: { objectKey: string; mimeType: string }[] = [];

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
      for (const img of images) allImageRows.push({ objectKey: img.objectKey, mimeType: img.mimeType });

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

    console.log("数据库导出完成");

    if (skipAssets) {
      console.log("已跳过资源文件下载（--skip-assets）");
    } else {
      const sourceS3 = loadS3Config("", "SaaS/AWS S3");
      console.log(
        `\n=== 下载资源文件 (bucket=${sourceS3.bucket} folder=${sourceS3.folder || "(root)"}, 共 ${allImageRows.length} 个) ===`,
      );

      const failures: { objectKey: string; error: string }[] = [];
      const tick = progressLogger("assets", allImageRows.length);
      await runWithConcurrency(allImageRows, concurrency, async ({ objectKey }) => {
        try {
          const localPath = assetLocalPath(outDir, objectKey);
          if (existsSync(localPath)) return;
          const body = await s3Get(sourceS3, objectKey);
          if (!body) throw new Error("源对象不存在");
          await writeBinaryFile(localPath, body);
        } catch (err) {
          failures.push({ objectKey, error: (err as Error).message });
        } finally {
          tick();
        }
      });

      if (failures.length > 0) {
        console.error(`\n⚠️ ${failures.length} 个文件下载失败（重新执行本脚本即可重试，已下载的文件会跳过重下）：`);
        for (const f of failures) console.error(`   - ${f.objectKey}: ${f.error}`);
      } else {
        console.log("全部资源文件下载完成");
      }

      await writeJsonFile(`${outDir}/manifest.json`, {
        teamId,
        teamSlug: team.slug,
        exportedAt: new Date().toISOString(),
        sourceS3Folder: sourceS3.folder,
        assetCount: allImageRows.length,
        assetFailures: failures.length,
      });
    }

    console.log(`\n=== 导出完成，请把整个目录 ${outDir} 传进私有化环境后执行 migrate-team-import.ts ===`);
  } finally {
    await source.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ 导出失败:", err);
  process.exit(1);
});
