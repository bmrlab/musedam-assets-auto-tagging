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
// 也可以不用本脚本，直接调生产应用的 GET /api/tagging/migration/export 拿到同样内容的单个 JSON 包，
// 见 src/app/(tagging)/api/tagging/migration/export/route.ts。
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
import { exportTeamBundle, MAX_PRESIGN_SECONDS, musedamTeamIdToSlug } from "@/lib/migration/export-team";
import { loadS3Config, presignGetUrl, writeJsonFile } from "./lib/migrate-team-shared";

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

  const teamSlug = musedamTeamIdRaw ? musedamTeamIdToSlug(musedamTeamIdRaw) : undefined;

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
    // 只签名不请求，不需要网络；凭证错了要到导入阶段下载时才会暴露，所以导出后最好抽一条链接手动打开验证
    const sourceS3 = args.skipPresign ? null : loadS3Config("", "SaaS S3");
    const bundle = await exportTeamBundle(
      source,
      args.teamSlug ? { teamSlug: args.teamSlug } : { teamId: args.teamId! },
      {
        presignExpires: args.presignExpires,
        presign: sourceS3 ? (objectKey, expires) => presignGetUrl(sourceS3, objectKey, expires) : undefined,
        log: (msg) => console.log(msg),
      },
    );

    const outDir = args.outDir || `./migration-export/team-${bundle.manifest.teamId}`;
    for (const [name, rows] of Object.entries(bundle.db)) {
      // team 表在目录形态里是单个对象，不是数组（导入脚本按此读取）
      await writeJsonFile(`${outDir}/db/${name}.json`, name === "team" ? rows[0] : rows);
    }
    await writeJsonFile(`${outDir}/assets.json`, bundle.assets);
    await writeJsonFile(`${outDir}/manifest.json`, bundle.manifest);

    const sample = bundle.assets.find((a) => a.sourceUrl)?.sourceUrl;
    if (sample) console.log(`  抽检链接（请手动打开确认可访问）: ${sample}`);
    console.log(`\n=== 导出完成，请把整个目录 ${outDir} 传进私有化环境后执行 migrate-team-import.ts ===`);
  } finally {
    await source.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ 导出失败:", err);
  process.exit(1);
});
