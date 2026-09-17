// 单租户私有化迁移 —— 导入核心逻辑。
// 被两处共用：
//   - scripts/migrate-team-import.ts（客户堡垒机里跑，读本地目录/文件）
//   - GET /api/tagging/migration/import（私有化应用内直接调用，从 URL 拉 bundle）
// 这里不依赖 Next / "server-only"，只依赖 Prisma client 和一个注入的对象存储适配器。
//
// 三个阶段：
//   db        按导出的字段原样 upsert 进目标库（图片表的 objectKey 此时还是 SaaS 上的值）
//   resources 按 bundle.assets 逐条：从 sourceUrl 下载 -> 上传到目标桶 -> update 该行的 objectKey/source
//   verify    核对各表行数
// 幂等性：全部走 upsert / 已存在即跳过，可以安全地重复执行、断点续传。

import type { PrismaClient } from "@/prisma/client";
import type { MigrationAsset, MigrationBundle } from "./export-team";

export type ImportPhase = "db" | "resources" | "verify" | "all";

// 目标对象存储适配器：脚本用 scripts/lib/migrate-team-shared.ts 的 SigV4 实现，
// 接口用 src/lib/s3.ts（读同一组 S3_* 环境变量）。
export type ImportStorage = {
  label: string;
  bucket: string;
  // 已规范化的 S3_FOLDER（无首尾斜杠），改写 objectKey 前缀时用
  folder: string;
  head: (objectKey: string) => Promise<boolean>;
  put: (objectKey: string, body: Buffer, contentType: string) => Promise<void>;
};

export type ImportOptions = {
  phase?: ImportPhase;
  dryRun?: boolean;
  storage?: ImportStorage;
  // 导出时 --skip-presign 没生成 sourceUrl 时，用 <base>/<objectKey> 拼下载地址
  sourceUrlBase?: string;
  // SaaS 侧的 S3_FOLDER；传了就把 objectKey 前缀从这个值改写成目标 storage.folder，不传原样保留
  rewriteFolder?: string;
  concurrency?: number;
  log?: (msg: string) => void;
};

export type ResourceFailure = { model: string; id: string; objectKey: string; error: string };

export type ImportResult = {
  teamId: number;
  dryRun: boolean;
  phase: ImportPhase;
  db?: { tables: Record<string, number> };
  resources?: { total: number; failed: number; failures: ResourceFailure[] };
  verify?: { ok: boolean; tables: { table: string; exported: number; target: number; ok: boolean }[] };
};

export function isImportPhase(v: unknown): v is ImportPhase {
  return v === "db" || v === "resources" || v === "verify" || v === "all";
}

export function assertMigrationBundle(bundle: unknown, from: string): asserts bundle is MigrationBundle {
  const b = bundle as Partial<MigrationBundle> | null;
  if (!b || !b.manifest || !b.db || !Array.isArray(b.assets) || !Array.isArray(b.db.team) || !b.db.team[0]) {
    throw new Error(`${from} 不是有效的迁移数据包（缺少 manifest/db/assets）`);
  }
}

// objectKey 在写入时就已经把 S3_FOLDER 前缀烤进去了（见 src/lib/s3.ts 的 buildStorageObjectKey）。
// 默认不改写：只要目标 S3_FOLDER 和 SaaS 侧配成一样的值，objectKey 原样搬过去就能用，最不容易出错。
export function remapObjectKey(objectKey: string, sourceFolder: string, targetFolder: string, rewrite: boolean) {
  if (!rewrite) return objectKey;
  const prefix = sourceFolder ? `${sourceFolder}/` : "";
  const stripped = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : objectKey;
  return targetFolder ? `${targetFolder}/${stripped}` : stripped;
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function progressLogger(log: (msg: string) => void, label: string, total: number) {
  let done = 0;
  return () => {
    done += 1;
    if (done === total || done % 50 === 0) log(`  [${label}] ${done}/${total}`);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 导出的行原样透传给 upsert
function rows<T = any>(bundle: MigrationBundle, name: string): T[] {
  return (bundle.db[name] ?? []) as T[];
}

async function importDatabase(
  target: PrismaClient,
  bundle: MigrationBundle,
  dryRun: boolean,
  log: (msg: string) => void,
) {
  log("\n=== 阶段一：导入数据库 ===");
  const counts: Record<string, number> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = bundle.db.team[0] as any;
  const teamId: number = team.id;

  const existingTargetTeam = await target.team.findUnique({ where: { id: teamId } });
  if (existingTargetTeam && existingTargetTeam.slug !== team.slug) {
    throw new Error(
      `目标库中 id=${teamId} 已经存在但 slug 不一致（目标: ${existingTargetTeam.slug}, 源: ${team.slug}），` +
        `疑似 id 冲突，已中止，请确认目标库是不是全新的私有化库`,
    );
  }

  if (dryRun) {
    log(`[dry-run] 将导入 Team #${teamId} (${team.slug} / ${team.name})`);
  } else {
    await target.team.upsert({ where: { id: teamId }, create: team, update: { name: team.name, slug: team.slug } });
  }
  counts.team = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各表结构一致，动态取 model
  const tgt = target as any;
  const upsertRows = async (label: string, table: string, model = table) => {
    const list = rows(bundle, table);
    counts[table] = list.length;
    if (list.length === 0) {
      log(`  [${label}] 0 行，跳过`);
      return;
    }
    const tick = progressLogger(log, label, list.length);
    for (const row of list) {
      if (!dryRun) await tgt[model].upsert({ where: { id: row.id }, create: row, update: row });
      tick();
    }
  };

  await upsertRows("TeamConfig", "teamConfig");

  // AssetTag 有自引用 parentId，两遍写入绕开顺序问题：先都以 parentId=null 建好，再补 UPDATE parentId。
  const assetTags = rows(bundle, "assetTag");
  counts.assetTag = assetTags.length;
  {
    const tick = progressLogger(log, "AssetTag (pass 1/2, parentId=null)", assetTags.length);
    for (const row of assetTags) {
      if (!dryRun) {
        await target.assetTag.upsert({
          where: { id: row.id },
          create: { ...row, parentId: null },
          update: { ...row, parentId: undefined },
        });
      }
      tick();
    }
    const withParent = assetTags.filter((t) => t.parentId !== null);
    const tick2 = progressLogger(log, "AssetTag (pass 2/2, 补 parentId)", withParent.length);
    for (const row of withParent) {
      if (!dryRun) await target.assetTag.update({ where: { id: row.id }, data: { parentId: row.parentId } });
      tick2();
    }
  }

  await upsertRows("AssetObject", "assetObject");

  const kinds = [
    { kind: "assetLogo", typeModel: "assetLogoType", imageModel: "assetLogoImage", tagModel: "assetLogoTag" },
    { kind: "assetIp", typeModel: "assetIpType", imageModel: "assetIpImage", tagModel: "assetIpTag" },
    { kind: "assetProduct", typeModel: "assetProductType", imageModel: "assetProductImage", tagModel: "assetProductTag" },
    { kind: "assetPerson", typeModel: "assetPersonType", imageModel: "assetPersonImage", tagModel: "assetPersonTag" },
  ] as const;
  for (const { kind, typeModel, imageModel, tagModel } of kinds) {
    await upsertRows(typeModel, typeModel);
    await upsertRows(kind, kind);
    await upsertRows(imageModel, imageModel);
    await upsertRows(tagModel, tagModel);
  }

  // pgvector 表：Unsupported("vector(...)") 字段不在 Prisma Client API 里，走原生 SQL。
  for (const table of ["LogoVector", "IpVector", "ProductVector", "PersonVector"]) {
    const list = rows<Record<string, unknown> & { embeddingText: string }>(bundle, table);
    counts[table] = list.length;
    if (list.length === 0) {
      log(`  [${table}] 0 行，跳过`);
      continue;
    }
    const tick = progressLogger(log, table, list.length);
    for (const row of list) {
      if (!dryRun) {
        const { embeddingText, ...rest } = row;
        delete rest.embedding;
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
      }
      tick();
    }
  }

  await upsertRows("TaggingQueueItem", "taggingQueueItem");
  await upsertRows("TaggingAuditItem", "taggingAuditItem");

  if (!dryRun) {
    log("  重置自增序列（setval 到当前最大 id，避免后续插入主键冲突）...");
    for (const table of ["Team", "TeamConfig", "AssetTag", "AssetObject", "TaggingQueueItem", "TaggingAuditItem"]) {
      await target.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
      );
    }
  }

  log("=== 阶段一完成 ===");
  return { teamId, tables: counts };
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

async function importResources(
  target: PrismaClient,
  bundle: MigrationBundle,
  teamId: number,
  opts: Required<Pick<ImportOptions, "dryRun" | "concurrency" | "log">> &
    Pick<ImportOptions, "storage" | "sourceUrlBase" | "rewriteFolder">,
) {
  const { log, dryRun } = opts;
  log(`\n=== 阶段二：下载图片并上传到目标对象存储 (teamId=${teamId}) ===`);

  const assets: MigrationAsset[] = bundle.assets;
  if (assets.length === 0) {
    log("  assets 为空，没有图片需要迁移");
    log("=== 阶段二完成 ===");
    return { total: 0, failed: 0, failures: [] as ResourceFailure[] };
  }

  const sourceUrlBase = (opts.sourceUrlBase || "").replace(/\/+$/, "");
  const missingUrl = assets.filter((a) => !a.sourceUrl).length;
  if (missingUrl > 0 && !sourceUrlBase) {
    throw new Error(`assets 里有 ${missingUrl} 条没有 sourceUrl（导出时可能加了 --skip-presign），需要提供 sourceUrlBase`);
  }
  const expiresAt = bundle.manifest.signedUrlExpiresAt;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    throw new Error(`assets 里的签名链接已于 ${expiresAt} 过期，请重新导出`);
  }

  const storage = opts.storage;
  if (!storage) throw new Error("resources 阶段需要目标对象存储配置（S3_* 环境变量）");
  const rewrite = opts.rewriteFolder !== undefined;
  log(`  来源: ${missingUrl === 0 ? "assets 里的签名链接" : `${sourceUrlBase}/<objectKey>`}`);
  if (expiresAt) log(`  签名链接过期时间: ${expiresAt}`);
  log(`  目标: ${storage.label} bucket=${storage.bucket} folder=${storage.folder || "(root)"}`);
  log(
    `  改写目录前缀: ${rewrite ? `是（${opts.rewriteFolder || "(root)"} -> ${storage.folder || "(root)"}）` : "否（objectKey 原样保留）"}`,
  );

  const failures: ResourceFailure[] = [];
  const tick = progressLogger(log, "assets", assets.length);

  await runWithConcurrency(assets, opts.concurrency, async (row) => {
    try {
      const sourceUrl = row.sourceUrl || buildSourceUrl(sourceUrlBase, row.objectKey);
      // 导出的 objectKey 是 SaaS 上的值，目标 key 按需改写前缀
      const newKey = remapObjectKey(row.objectKey, opts.rewriteFolder || "", storage.folder, rewrite);
      if (dryRun) return;

      // 已经上传过（重跑）就不再下载
      if (!(await storage.head(newKey))) {
        const body = await fetchSourceObject(sourceUrl);
        await storage.put(newKey, body, row.mimeType);
      }

      // 文件到位后再 update 数据库字段，指向目标桶里的 key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 动态 model 访问
      const model = (target as any)[row.model];
      const current = await model.findUnique({ where: { id: row.id }, select: { objectKey: true, source: true } });
      if (!current) throw new Error("目标库中不存在该图片记录，请先执行 db 阶段");
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
    log(`\n  ⚠️ ${failures.length} 个对象迁移失败（可重复执行来重试这些失败项）：`);
    for (const f of failures) log(`   - [${f.model}#${f.id}] ${f.objectKey}: ${f.error}`);
  } else {
    log(dryRun ? "  [dry-run] 未实际下载/上传/更新" : "  全部图片已上传并更新数据库字段");
  }
  log("=== 阶段二完成 ===");
  return { total: assets.length, failed: failures.length, failures };
}

async function verify(target: PrismaClient, bundle: MigrationBundle, teamId: number, log: (msg: string) => void) {
  log(`\n=== 阶段三：核对 (teamId=${teamId}) ===`);

  const checks: [string, string, () => Promise<number>][] = [
    ["assetTag", "AssetTag", () => target.assetTag.count({ where: { teamId } })],
    ["assetObject", "AssetObject", () => target.assetObject.count({ where: { teamId } })],
    ["assetLogo", "AssetLogo", () => target.assetLogo.count({ where: { teamId } })],
    ["assetIp", "AssetIp", () => target.assetIp.count({ where: { teamId } })],
    ["assetProduct", "AssetProduct", () => target.assetProduct.count({ where: { teamId } })],
    ["assetPerson", "AssetPerson", () => target.assetPerson.count({ where: { teamId } })],
    ["taggingQueueItem", "TaggingQueueItem", () => target.taggingQueueItem.count({ where: { teamId } })],
    ["taggingAuditItem", "TaggingAuditItem", () => target.taggingAuditItem.count({ where: { teamId } })],
  ];

  const tables: { table: string; exported: number; target: number; ok: boolean }[] = [];
  for (const [key, label, count] of checks) {
    const exported = rows(bundle, key).length;
    const t = await count();
    const ok = exported === t;
    tables.push({ table: label, exported, target: t, ok });
    log(`  ${ok ? "✅" : "❌"} ${label}: 导出=${exported} 目标=${t}`);
  }
  const allOk = tables.every((t) => t.ok);
  log(allOk ? "  行数全部一致" : "  ⚠️ 存在行数不一致的表，请检查阶段一日志");
  log("=== 阶段三完成 ===");
  return { ok: allOk, tables };
}

export async function importTeamBundle(
  target: PrismaClient,
  bundle: MigrationBundle,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const phase = opts.phase ?? "all";
  const dryRun = opts.dryRun ?? false;
  const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 8;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamId: number = (bundle.db.team[0] as any).id;
  const result: ImportResult = { teamId, dryRun, phase };

  if (phase === "all" || phase === "db") {
    result.db = { tables: (await importDatabase(target, bundle, dryRun, log)).tables };
  }
  if (phase === "all" || phase === "resources") {
    result.resources = await importResources(target, bundle, teamId, {
      dryRun,
      concurrency,
      log,
      storage: opts.storage,
      sourceUrlBase: opts.sourceUrlBase,
      rewriteFolder: opts.rewriteFolder,
    });
  }
  if (phase === "all" || phase === "verify") {
    result.verify = await verify(target, bundle, teamId, log);
  }
  return result;
}
