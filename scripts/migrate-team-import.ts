// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 导入阶段（命令行入口）。
// 核心逻辑在 src/lib/migration/import-team.ts，与 GET /api/tagging/migration/import 共用。
//
// 运行位置：客户堡垒机 / 私有化环境内部。连目标阿里云 RDS（DATABASE_URL）
//          + 目标阿里云 OSS（AWS_ACCESS_KEY_ID / S3_* 这几个私有化 App 自己就要用到的变量）。
//          资源阶段还需要能访问 assets.json 里的 SaaS 图片签名下载链接（出公网）。
// 输入（三选一）：
//   --in-dir=<目录>        scripts/migrate-team-export.ts 产出的目录
//   --in-file=<bundle.json> 生产接口 GET /api/tagging/migration/export 下载的单个 JSON 包
//   --in-url=<https://...>  同上，但从 URL（例如放在 OSS 上的签名链接）直接拉取
//
// 三个阶段：
//   db        按导出的字段原样 upsert 进客户库（图片表的 objectKey 此时还是 SaaS 上的值）
//   resources 按 assets 逐条：从 sourceUrl 下载 -> 上传到客户 OSS -> update 该行的 objectKey/source
//   verify    核对各表行数
//
// 幂等性：全部走 upsert / 已存在即跳过，可以安全地重复执行、断点续传。
//
// 用法（分阶段执行，方便核对/重试）：
//   npx tsx scripts/migrate-team-import.ts --in-dir=./migration-export/team-1234 --only=db
//   npx tsx scripts/migrate-team-import.ts --in-dir=./migration-export/team-1234 --only=resources
//   npx tsx scripts/migrate-team-import.ts --in-dir=./migration-export/team-1234 --only=verify
//   npx tsx scripts/migrate-team-import.ts --in-dir=./migration-export/team-1234           # 三步都跑
//
// --source-url-base=<图片公网地址前缀>（或环境变量 SOURCE_PUBLIC_URL_BASE）：传了就一律用 <前缀>/<objectKey> 下载，
// 忽略包内签名链接。用于导出时加了 --skip-presign，或先用 migrate-team-mirror-assets.ts 把图片镜像到了别的桶。
// 需要改 objectKey 目录前缀（SaaS 的 S3_FOLDER 和这边 S3_FOLDER 配的不一样）时加 --rewrite-folder=<SaaS 侧 folder>。
// --batch-size=<行数> 控制 db 阶段每个事务写多少行（默认 200），--resource-concurrency=<n> 控制图片并发（默认 8）。

import { loadEnvConfig } from "@next/env";
import type { MigrationBundle } from "@/lib/migration/export-team";
import { assertMigrationBundle, importTeamBundle, isImportPhase, type ImportStorage } from "@/lib/migration/import-team";
import { PrismaClient } from "@/prisma/client";
import { loadS3Config, readJsonFile, s3Head, s3Put } from "./lib/migrate-team-shared";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const has = (name: string) => args.includes(`--${name}`);

  const inputs = [get("in-dir"), get("in-file"), get("in-url")].filter(Boolean);
  if (inputs.length === 0) throw new Error("缺少参数：--in-dir=<导出目录>、--in-file=<bundle.json> 或 --in-url=<链接>");
  if (inputs.length > 1) throw new Error("--in-dir / --in-file / --in-url 只能三选一");

  const only = get("only") || "all";
  if (!isImportPhase(only)) throw new Error(`--only 不合法: ${only}（可选 db / resources / verify / all）`);

  return {
    inDir: get("in-dir"),
    inFile: get("in-file"),
    inUrl: get("in-url"),
    dryRun: has("dry-run"),
    only,
    sourceUrlBase: get("source-url-base") || process.env.SOURCE_PUBLIC_URL_BASE || "",
    // --rewrite-folder=<SaaS 侧 S3_FOLDER>；不传则 objectKey 原样保留
    rewriteFolder: get("rewrite-folder"),
    concurrency: Number(get("resource-concurrency") || "8"),
    batchSize: Number(get("batch-size") || "200"),
  };
}

const DB_TABLES = [
  "team",
  "teamConfig",
  "assetTag",
  "assetObject",
  "assetLogoType",
  "assetLogo",
  "assetLogoImage",
  "assetLogoTag",
  "assetIpType",
  "assetIp",
  "assetIpImage",
  "assetIpTag",
  "assetProductType",
  "assetProduct",
  "assetProductImage",
  "assetProductTag",
  "assetPersonType",
  "assetPerson",
  "assetPersonImage",
  "assetPersonTag",
  "LogoVector",
  "IpVector",
  "ProductVector",
  "PersonVector",
  "taggingQueueItem",
  "taggingAuditItem",
];

// export 脚本落盘的目录形态 -> 和接口一致的 MigrationBundle
async function loadBundleFromDir(dir: string): Promise<MigrationBundle> {
  const db: Record<string, unknown[]> = {};
  for (const name of DB_TABLES) {
    const data = await readJsonFile<unknown>(`${dir}/db/${name}.json`);
    // team 表在目录形态里是单个对象
    db[name] = name === "team" ? [data] : (data as unknown[]);
  }
  return {
    manifest: await readJsonFile(`${dir}/manifest.json`),
    assets: await readJsonFile(`${dir}/assets.json`),
    db,
  };
}

async function loadBundleFromUrl(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`拉取 bundle 失败: ${res.status} ${url.split("?")[0]}`);
  return res.json();
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseArgs();

  let bundle: unknown;
  let from: string;
  if (args.inDir) {
    from = args.inDir;
    bundle = await loadBundleFromDir(args.inDir);
  } else if (args.inFile) {
    from = args.inFile;
    bundle = await readJsonFile(args.inFile);
  } else {
    from = args.inUrl!.split("?")[0];
    bundle = await loadBundleFromUrl(args.inUrl!);
  }
  assertMigrationBundle(bundle, from);
  console.log(`已读取 ${from}（Team #${bundle.manifest.teamId} ${bundle.manifest.teamSlug}，图片 ${bundle.assets.length} 张）`);

  // 只有 resources 阶段才需要目标桶配置；其它阶段不强求 S3_* 环境变量
  let storage: ImportStorage | undefined;
  if (args.only === "all" || args.only === "resources") {
    const cfg = loadS3Config("", "私有化/阿里云 OSS");
    storage = {
      label: cfg.label,
      bucket: cfg.bucket,
      folder: cfg.folder,
      head: (key) => s3Head(cfg, key),
      put: (key, body, contentType) => s3Put(cfg, key, body, contentType),
    };
  }

  const target = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const result = await importTeamBundle(target, bundle, {
      phase: args.only,
      dryRun: args.dryRun,
      storage,
      sourceUrlBase: args.sourceUrlBase,
      rewriteFolder: args.rewriteFolder,
      concurrency: args.concurrency,
      batchSize: args.batchSize,
      log: (msg) => console.log(msg),
    });
    if (result.resources?.failed) process.exitCode = 2;
    if (result.verify && !result.verify.ok) process.exitCode = 2;
  } finally {
    await target.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ 导入失败:", err);
  process.exit(1);
});
