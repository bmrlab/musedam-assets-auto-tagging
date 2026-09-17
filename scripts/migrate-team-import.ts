// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 导入阶段。
//
// 运行位置：客户堡垒机 / 私有化环境内部。连目标阿里云 RDS（DATABASE_URL）
//          + 目标阿里云 OSS（AWS_ACCESS_KEY_ID / S3_* 这几个私有化 App 自己就要用到的变量）。
//          资源阶段还需要能访问 assets.json 里的 SaaS 图片签名下载链接（出公网）。
// 输入：scripts/migrate-team-export.ts 产出、已经传进这台机器的本地目录（--in-dir），只含 JSON。
//
// 三个阶段：
//   db        按导出的字段原样 upsert 进客户库（图片表的 objectKey 此时还是 SaaS 上的值）
//   resources 按 assets.json 逐条：从 sourceUrl 下载 -> 上传到客户 OSS -> update 该行的 objectKey/source
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
// 导出时加了 --skip-presign（assets.json 里没有 sourceUrl）的话，需要 --source-url-base=<SaaS 图片公网地址前缀>
// （或环境变量 SOURCE_PUBLIC_URL_BASE），脚本会用 <前缀>/<objectKey> 拼下载地址，此时桶必须允许匿名读。
// 需要改 objectKey 目录前缀（SaaS 的 S3_FOLDER 和这边 S3_FOLDER 配的不一样）时加 --rewrite-folder=<SaaS 侧 folder>。

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@/prisma/client";
import {
  loadS3Config,
  progressLogger,
  readJsonFile,
  remapObjectKey,
  runWithConcurrency,
  s3Head,
  s3Put,
} from "./lib/migrate-team-shared";

type Phase = "db" | "resources" | "verify" | "all";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const has = (name: string) => args.includes(`--${name}`);

  const inDir = get("in-dir");
  if (!inDir) throw new Error("缺少必填参数 --in-dir=<导出目录>");

  const only = (get("only") as Phase) || "all";
  const sourceUrlBase = (get("source-url-base") || process.env.SOURCE_PUBLIC_URL_BASE || "").replace(/\/+$/, "");

  return {
    inDir,
    dryRun: has("dry-run"),
    only,
    sourceUrlBase,
    // --rewrite-folder=<SaaS 侧 S3_FOLDER>；不传则 objectKey 原样保留
    rewriteFolder: get("rewrite-folder"),
    concurrency: Number(get("resource-concurrency") || "8"),
  };
}

async function upsertRows<T extends { id: unknown }>(label: string, rows: T[], upsert: (row: T) => Promise<unknown>) {
  if (rows.length === 0) {
    console.log(`  [${label}] 0 行，跳过`);
    return;
  }
  const tick = progressLogger(label, rows.length);
  for (const row of rows) {
    await upsert(row);
    tick();
  }
}

async function importDatabase(target: PrismaClient, inDir: string, dryRun: boolean) {
  console.log(`\n=== 阶段一：导入数据库 (${inDir}/db) ===`);

  const team = await readJsonFile<any>(`${inDir}/db/team.json`);
  const teamId: number = team.id;

  const existingTargetTeam = await target.team.findUnique({ where: { id: teamId } });
  if (existingTargetTeam && existingTargetTeam.slug !== team.slug) {
    throw new Error(
      `目标库中 id=${teamId} 已经存在但 slug 不一致（目标: ${existingTargetTeam.slug}, 源: ${team.slug}），` +
        `疑似 id 冲突，已中止，请确认目标库是不是全新的私有化库`,
    );
  }

  if (dryRun) {
    console.log(`[dry-run] 将导入 Team #${teamId} (${team.slug} / ${team.name})`);
  } else {
    await target.team.upsert({
      where: { id: teamId },
      create: team,
      update: { name: team.name, slug: team.slug },
    });
  }

  const teamConfigs = await readJsonFile<any[]>(`${inDir}/db/teamConfig.json`);
  await upsertRows("TeamConfig", teamConfigs, (row) =>
    dryRun ? Promise.resolve() : target.teamConfig.upsert({ where: { id: row.id }, create: row, update: row }),
  );

  // AssetTag 有自引用 parentId，两遍写入绕开顺序问题：先都以 parentId=null 建好，再补 UPDATE parentId。
  const assetTags = await readJsonFile<any[]>(`${inDir}/db/assetTag.json`);
  await upsertRows("AssetTag (pass 1/2, parentId=null)", assetTags, (row) =>
    dryRun
      ? Promise.resolve()
      : target.assetTag.upsert({
          where: { id: row.id },
          create: { ...row, parentId: null },
          update: { ...row, parentId: undefined },
        }),
  );
  await upsertRows(
    "AssetTag (pass 2/2, 补 parentId)",
    assetTags.filter((t) => t.parentId !== null),
    (row) => (dryRun ? Promise.resolve() : target.assetTag.update({ where: { id: row.id }, data: { parentId: row.parentId } })),
  );

  const assetObjects = await readJsonFile<any[]>(`${inDir}/db/assetObject.json`);
  await upsertRows("AssetObject", assetObjects, (row) =>
    dryRun ? Promise.resolve() : target.assetObject.upsert({ where: { id: row.id }, create: row, update: row }),
  );

  type Kind = "assetLogo" | "assetIp" | "assetProduct" | "assetPerson";
  const kinds: { kind: Kind; typeModel: string; imageModel: string; tagModel: string }[] = [
    { kind: "assetLogo", typeModel: "assetLogoType", imageModel: "assetLogoImage", tagModel: "assetLogoTag" },
    { kind: "assetIp", typeModel: "assetIpType", imageModel: "assetIpImage", tagModel: "assetIpTag" },
    { kind: "assetProduct", typeModel: "assetProductType", imageModel: "assetProductImage", tagModel: "assetProductTag" },
    { kind: "assetPerson", typeModel: "assetPersonType", imageModel: "assetPersonImage", tagModel: "assetPersonTag" },
  ];

  for (const { kind, typeModel, imageModel, tagModel } of kinds) {
    // biome-ignore lint: 四类资产结构一致，动态取 model
    const tgt = target as any;

    const types = await readJsonFile<any[]>(`${inDir}/db/${typeModel}.json`);
    await upsertRows(typeModel, types, (row) =>
      dryRun ? Promise.resolve() : tgt[typeModel].upsert({ where: { id: row.id }, create: row, update: row }),
    );

    const entities = await readJsonFile<any[]>(`${inDir}/db/${kind}.json`);
    await upsertRows(kind, entities, (row) =>
      dryRun ? Promise.resolve() : tgt[kind].upsert({ where: { id: row.id }, create: row, update: row }),
    );

    const images = await readJsonFile<any[]>(`${inDir}/db/${imageModel}.json`);
    await upsertRows(imageModel, images, (row) =>
      dryRun ? Promise.resolve() : tgt[imageModel].upsert({ where: { id: row.id }, create: row, update: row }),
    );

    const tags = await readJsonFile<any[]>(`${inDir}/db/${tagModel}.json`);
    await upsertRows(tagModel, tags, (row) =>
      dryRun ? Promise.resolve() : tgt[tagModel].upsert({ where: { id: row.id }, create: row, update: row }),
    );
  }

  // pgvector 表：Unsupported("vector(...)") 字段不在 Prisma Client API 里，走原生 SQL。
  for (const table of ["LogoVector", "IpVector", "ProductVector", "PersonVector"]) {
    const rows = await readJsonFile<Array<Record<string, unknown>>>(`${inDir}/db/${table}.json`);
    const tick = progressLogger(table, rows.length);
    for (const row of rows) {
      if (dryRun) {
        tick();
        continue;
      }
      const { embedding: _embedding, embeddingText, ...rest } = row as Record<string, unknown> & {
        embeddingText: string;
      };
      // 通过 jsonb_populate_record 让 Postgres 按表定义自己做类型转换（timestamptz / uuid / vector），
      // 避免 Prisma 原生参数把 ISO 字符串当 text 传导致的类型不匹配。
      const columns = Object.keys(rest);
      const setClause = columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
      await target.$executeRawUnsafe(
        `INSERT INTO "${table}"
         SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb || jsonb_build_object('embedding', $2::text))
         ON CONFLICT ("id") DO UPDATE SET ${setClause}, "embedding" = EXCLUDED."embedding"`,
        JSON.stringify(rest),
        embeddingText,
      );
      tick();
    }
    if (rows.length === 0) console.log(`  [${table}] 0 行，跳过`);
  }

  const queueItems = await readJsonFile<any[]>(`${inDir}/db/taggingQueueItem.json`);
  await upsertRows("TaggingQueueItem", queueItems, (row) =>
    dryRun ? Promise.resolve() : target.taggingQueueItem.upsert({ where: { id: row.id }, create: row, update: row }),
  );

  const auditItems = await readJsonFile<any[]>(`${inDir}/db/taggingAuditItem.json`);
  await upsertRows("TaggingAuditItem", auditItems, (row) =>
    dryRun ? Promise.resolve() : target.taggingAuditItem.upsert({ where: { id: row.id }, create: row, update: row }),
  );

  if (!dryRun) {
    console.log("  重置自增序列（setval 到当前最大 id，避免后续插入主键冲突）...");
    for (const table of ["Team", "TeamConfig", "AssetTag", "AssetObject", "TaggingQueueItem", "TaggingAuditItem"]) {
      await target.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
      );
    }
  }

  console.log("=== 阶段一完成 ===");
  return teamId;
}

function buildSourceUrl(base: string, objectKey: string) {
  return `${base}/${objectKey.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchSourceObject(url: string) {
  const res = await fetch(url);
  const shown = url.split("?")[0]; // 日志里不打印签名参数
  if (res.status === 404) throw new Error(`源文件不存在 (404): ${shown}`);
  if (!res.ok) throw new Error(`下载源文件失败: ${res.status} ${shown} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

type AssetEntry = { model: string; id: string; objectKey: string; mimeType: string; sourceUrl?: string };

async function importResources(
  target: PrismaClient,
  inDir: string,
  teamId: number,
  opts: { dryRun: boolean; sourceUrlBase: string; rewriteFolder?: string; concurrency: number },
) {
  console.log(`\n=== 阶段二：下载图片并上传到客户 OSS (teamId=${teamId}) ===`);

  const assets = await readJsonFile<AssetEntry[]>(`${inDir}/assets.json`);
  const manifest = await readJsonFile<{ signedUrlExpiresAt?: string | null }>(`${inDir}/manifest.json`);
  if (assets.length === 0) {
    console.log("  assets.json 为空，没有图片需要迁移");
    console.log("=== 阶段二完成 ===");
    return [];
  }

  const missingUrl = assets.filter((a) => !a.sourceUrl).length;
  if (missingUrl > 0 && !opts.sourceUrlBase) {
    throw new Error(
      `assets.json 里有 ${missingUrl} 条没有 sourceUrl（导出时可能加了 --skip-presign），需要提供 --source-url-base`,
    );
  }
  if (manifest.signedUrlExpiresAt && new Date(manifest.signedUrlExpiresAt).getTime() < Date.now()) {
    throw new Error(`assets.json 里的签名链接已于 ${manifest.signedUrlExpiresAt} 过期，请重新导出`);
  }

  const targetS3 = loadS3Config("", "私有化/阿里云 OSS");
  const rewrite = opts.rewriteFolder !== undefined;
  console.log(`  来源: ${missingUrl === 0 ? "assets.json 里的签名链接" : `${opts.sourceUrlBase}/<objectKey>`}`);
  if (manifest.signedUrlExpiresAt) console.log(`  签名链接过期时间: ${manifest.signedUrlExpiresAt}`);
  console.log(`  目标: ${targetS3.label} bucket=${targetS3.bucket} folder=${targetS3.folder || "(root)"}`);
  console.log(
    `  改写目录前缀: ${rewrite ? `是（${opts.rewriteFolder || "(root)"} -> ${targetS3.folder || "(root)"}）` : "否（objectKey 原样保留）"}`,
  );

  const failures: { model: string; id: string; objectKey: string; error: string }[] = [];
  const tick = progressLogger("assets", assets.length);

  await runWithConcurrency(assets, opts.concurrency, async (row) => {
    try {
      const sourceUrl = row.sourceUrl || buildSourceUrl(opts.sourceUrlBase, row.objectKey);
      // 导出的 objectKey 是 SaaS 上的值，目标 key 按需改写前缀
      const newKey = remapObjectKey(row.objectKey, opts.rewriteFolder || "", targetS3.folder, rewrite);

      if (opts.dryRun) return;

      // 已经上传过（重跑）就不再下载
      const alreadyThere = await s3Head(targetS3, newKey);
      if (!alreadyThere) {
        const body = await fetchSourceObject(sourceUrl);
        await s3Put(targetS3, newKey, body, row.mimeType);
      }

      // 文件到位后再 update 数据库字段，指向客户桶里的 key
      // biome-ignore lint: 动态 model 访问
      const model = (target as any)[row.model];
      const current = await model.findUnique({ where: { id: row.id }, select: { objectKey: true, source: true } });
      if (!current) throw new Error("目标库中不存在该图片记录，请先执行 --only=db");
      if (current.objectKey !== newKey || current.source !== "oss") {
        await model.update({ where: { id: row.id }, data: { objectKey: newKey, source: "oss" } });
      }
    } catch (err) {
      failures.push({ model: row.model, id: row.id, objectKey: row.objectKey, error: (err as Error).message });
    } finally {
      tick();
    }
  });

  if (failures.length > 0) {
    console.error(`\n  ⚠️ ${failures.length} 个对象迁移失败（脚本可重复执行来重试这些失败项）：`);
    for (const f of failures) console.error(`   - [${f.model}#${f.id}] ${f.objectKey}: ${f.error}`);
  } else {
    console.log(opts.dryRun ? "  [dry-run] 未实际下载/上传/更新" : "  全部图片已上传并更新数据库字段");
  }

  console.log("=== 阶段二完成 ===");
  return failures;
}

async function verify(target: PrismaClient, inDir: string, teamId: number) {
  console.log(`\n=== 阶段三：核对 (teamId=${teamId}) ===`);

  const checks: [string, string, () => Promise<number>][] = [
    ["assetTag.json", "AssetTag", () => target.assetTag.count({ where: { teamId } })],
    ["assetObject.json", "AssetObject", () => target.assetObject.count({ where: { teamId } })],
    ["assetLogo.json", "AssetLogo", () => target.assetLogo.count({ where: { teamId } })],
    ["assetIp.json", "AssetIp", () => target.assetIp.count({ where: { teamId } })],
    ["assetProduct.json", "AssetProduct", () => target.assetProduct.count({ where: { teamId } })],
    ["assetPerson.json", "AssetPerson", () => target.assetPerson.count({ where: { teamId } })],
    ["taggingQueueItem.json", "TaggingQueueItem", () => target.taggingQueueItem.count({ where: { teamId } })],
    ["taggingAuditItem.json", "TaggingAuditItem", () => target.taggingAuditItem.count({ where: { teamId } })],
  ];

  let allOk = true;
  for (const [file, label, tgtCount] of checks) {
    const exported = await readJsonFile<any[]>(`${inDir}/db/${file}`);
    const t = await tgtCount();
    const ok = exported.length === t;
    allOk = allOk && ok;
    console.log(`  ${ok ? "✅" : "❌"} ${label}: 导出=${exported.length} 目标=${t}`);
  }

  console.log(allOk ? "  行数全部一致" : "  ⚠️ 存在行数不一致的表，请检查上面阶段一日志");
  console.log("=== 阶段三完成 ===");
}

async function main() {
  loadEnvConfig(process.cwd());
  const { inDir, dryRun, only, sourceUrlBase, rewriteFolder, concurrency } = parseArgs();

  const target = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  try {
    let teamId: number;
    if (only === "all" || only === "db") {
      teamId = await importDatabase(target, inDir, dryRun);
    } else {
      teamId = (await readJsonFile<any>(`${inDir}/db/team.json`)).id;
    }

    if (only === "all" || only === "resources") {
      await importResources(target, inDir, teamId, { dryRun, sourceUrlBase, rewriteFolder, concurrency });
    }

    if (only === "all" || only === "verify") {
      await verify(target, inDir, teamId);
    }
  } finally {
    await target.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ 导入失败:", err);
  process.exit(1);
});
