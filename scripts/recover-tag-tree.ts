// #!/usr/bin/env tsx
//
// 标签树恢复脚本：从库里其他表残留的标签路径把被误删的 AssetTag 重建回来，并把外键重新接上。
//
// 背景：旧版「从 MuseDAM 同步」会先 deleteMany 团队全部标签再重建。删掉的标签本身没了，但这些表
// 都以 JSON 保存着完整的标签路径（tagPath: ["一级","二级","三级"]），部分还保存着原始 id：
//   - TaggingQueueItem.result.tagsWithScore[] / predictions[].tags[]   → tagPath + 原始 leafTagId
//   - TaggingQueueItem.extra.requiredGroupFallback                       → tagPath + 原始 id / parentId
//   - TaggingAuditItem.tagPath                                            → tagPath（leafTagId 已被置空）
//   - AssetObject.tags[]                                                  → tagPath + tagSlug（MuseDAM id）
//   - AssetLogoTag / AssetIpTag / AssetProductTag / AssetPersonTag.tagPath → tagPath（assetTagId 已被置空）
//
// 做法：
//   1. 汇总以上来源得到路径集合；每条路径投票出原始 id（若有）和 slug（若有）。
//   2. 逐层重建：父节点 + 名称已存在的行直接复用；不存在的新建。原始 id 已知且未被占用时按原 id 插入，
//      这样审核项 / 特征库绑定能接回原 id；否则用自增。最后把序列拨到 max(id)。
//   3. 回填外键：TaggingAuditItem.leafTagId、四张特征标签表的 assetTagId，按 tagPath 反查。
//
// 恢复不了的：AssetTag.extra 里的配置（匹配关键词 / 排除关键词 / 子标签只能选一个 / 必打 / 证据策略 / 描述）
// 以及从没被任何素材预测过、也没绑定到特征库的标签。这些需要在标签管理页手动补。
//
// 用法（默认 dry-run 只打印，不写库）：
//   npx tsx scripts/recover-tag-tree.ts --team=<teamId 或 team slug>
//   npx tsx scripts/recover-tag-tree.ts --team=<...> --out=./recovered-tree.json   # 把重建出的树导出成 JSON 看一眼
//   npx tsx scripts/recover-tag-tree.ts --team=<...> --apply                        # 真正写库
//   --since=2026-09-01   只采信这个时间之后的队列记录 / 审核项（避免把很久以前故意删掉的标签也复活）
//
// 建议顺序：先 dry-run 看统计和树是否合理，再 --apply；写完后在标签管理页点「手动同步当前标签树到 MuseDAM」
// 把恢复出来但 MuseDAM 没有的标签推上去、回填 slug。不要再点「从 MuseDAM 同步」。

import { PrismaClient, type Prisma } from "@/prisma/client";
import { loadEnvConfig } from "@next/env";
import { writeFile } from "node:fs/promises";

type PathKey = string; // 各级名称用 \u0000 拼接
type Node = {
  path: string[];
  idVotes: Map<number, number>;
  slugVotes: Map<string, number>;
  sources: Set<string>;
};

const SEP = "\u0000";
const keyOf = (path: string[]) => path.map((p) => p.trim()).join(SEP);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) =>
    args
      .find((a) => a.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
  return {
    team: get("team"),
    out: get("out"),
    since: get("since") ? new Date(get("since")!) : undefined,
    apply: args.includes("--apply"),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string") && value.length > 0;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { team: teamArg, out, since, apply } = parseArgs();
  if (since && Number.isNaN(since.getTime())) {
    console.error("--since 不是合法日期");
    process.exit(1);
  }
  if (!teamArg) {
    console.error(
      "用法: npx tsx scripts/recover-tag-tree.ts --team=<teamId|slug> [--out=file.json] [--apply]",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const team = /^\d+$/.test(teamArg)
      ? await prisma.team.findUnique({ where: { id: Number(teamArg) } })
      : await prisma.team.findUnique({ where: { slug: teamArg } });
    if (!team) throw new Error(`team not found: ${teamArg}`);
    const teamId = team.id;
    console.log(
      `team #${teamId} ${team.slug}  mode=${apply ? "APPLY" : "dry-run"}${since ? `  since=${since.toISOString()}` : ""}`,
    );

    // ---------- 1. 汇总路径 ----------
    const nodes = new Map<PathKey, Node>();
    const touch = (path: string[], source: string, id?: number | null, slug?: string | null) => {
      if (!isStringArray(path) || path.length > 3) return;
      // 同时登记所有祖先路径，保证父节点也在树里
      for (let depth = 1; depth <= path.length; depth++) {
        const sub = path.slice(0, depth);
        const k = keyOf(sub);
        let node = nodes.get(k);
        if (!node) {
          node = {
            path: sub.map((p) => p.trim()),
            idVotes: new Map(),
            slugVotes: new Map(),
            sources: new Set(),
          };
          nodes.set(k, node);
        }
        node.sources.add(source);
        if (depth === path.length) {
          if (typeof id === "number" && Number.isInteger(id) && id > 0) {
            node.idVotes.set(id, (node.idVotes.get(id) ?? 0) + 1);
          }
          if (slug) node.slugVotes.set(slug, (node.slugVotes.get(slug) ?? 0) + 1);
        }
      }
    };

    // 现有标签（可能是同步后剩下的那部分，或之前恢复过一半的）
    const existingRows = await prisma.assetTag.findMany({ where: { teamId } });
    const existingById = new Map(existingRows.map((r) => [r.id, r]));
    const pathOfExisting = (row: (typeof existingRows)[number]): string[] => {
      const chain: string[] = [];
      let cur: (typeof existingRows)[number] | undefined = row;
      while (cur) {
        chain.unshift(cur.name);
        cur = cur.parentId ? existingById.get(cur.parentId) : undefined;
      }
      return chain;
    };
    for (const row of existingRows) touch(pathOfExisting(row), "existing", row.id, row.slug);

    // 队列结果：tagsWithScore / predictions / requiredGroupFallback
    const queueItems = await prisma.taggingQueueItem.findMany({
      where: { teamId, taskType: { not: "test" }, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { result: true, extra: true },
    });
    for (const item of queueItems) {
      const result = item.result as {
        tagsWithScore?: Array<{ leafTagId?: number; tagPath?: unknown }>;
        predictions?: Array<{ tags?: Array<{ leafTagId?: number; tagPath?: unknown }> }>;
      } | null;
      for (const t of result?.tagsWithScore ?? [])
        touch(t.tagPath as string[], "queue.tagsWithScore", t.leafTagId);
      for (const p of result?.predictions ?? []) {
        for (const t of p.tags ?? [])
          touch(t.tagPath as string[], "queue.predictions", t.leafTagId);
      }
      const extra = item.extra as {
        requiredGroupFallback?: {
          readmitted?: Array<{ parentId?: number; leafTagId?: number; tagPath?: unknown }>;
          forced?: Array<{ leafTagId?: number; tagPath?: unknown }>;
        };
      } | null;
      for (const r of extra?.requiredGroupFallback?.readmitted ?? []) {
        touch(r.tagPath as string[], "queue.requiredFallback", r.leafTagId);
        if (isStringArray(r.tagPath) && r.tagPath.length > 1 && typeof r.parentId === "number") {
          touch(r.tagPath.slice(0, -1), "queue.requiredFallback.parent", r.parentId);
        }
      }
      for (const f of extra?.requiredGroupFallback?.forced ?? [])
        touch(f.tagPath as string[], "queue.requiredFallback", f.leafTagId);
    }

    // 审核项
    const auditItems = await prisma.taggingAuditItem.findMany({
      where: { teamId, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { id: true, tagPath: true, leafTagId: true },
    });
    for (const a of auditItems) touch(a.tagPath as string[], "audit", a.leafTagId);

    // 素材上的标签（带 MuseDAM slug）
    const assets = await prisma.assetObject.findMany({ where: { teamId }, select: { tags: true } });
    for (const a of assets) {
      const tags = a.tags as Array<{ tagId?: number; tagSlug?: string; tagPath?: unknown }> | null;
      for (const t of tags ?? []) touch(t.tagPath as string[], "asset.tags", t.tagId, t.tagSlug);
    }

    // 特征库绑定
    const [logoTags, ipTags, productTags, personTags] = await Promise.all([
      prisma.assetLogoTag.findMany({
        where: { assetLogo: { teamId } },
        select: { id: true, tagPath: true, assetTagId: true },
      }),
      prisma.assetIpTag.findMany({
        where: { assetIp: { teamId } },
        select: { id: true, tagPath: true, assetTagId: true },
      }),
      prisma.assetProductTag.findMany({
        where: { assetProduct: { teamId } },
        select: { id: true, tagPath: true, assetTagId: true },
      }),
      prisma.assetPersonTag.findMany({
        where: { assetPerson: { teamId } },
        select: { id: true, tagPath: true, assetTagId: true },
      }),
    ]);
    for (const t of logoTags) touch(t.tagPath as string[], "feature.logo", t.assetTagId);
    for (const t of ipTags) touch(t.tagPath as string[], "feature.ip", t.assetTagId);
    for (const t of productTags) touch(t.tagPath as string[], "feature.product", t.assetTagId);
    for (const t of personTags) touch(t.tagPath as string[], "feature.person", t.assetTagId);

    // ---------- 2. 规划重建 ----------
    const ordered = [...nodes.values()].sort(
      (a, b) =>
        a.path.length - b.path.length || a.path.join("/").localeCompare(b.path.join("/"), "zh"),
    );
    const bestVote = <T>(votes: Map<T, number>): T | undefined =>
      [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    // 现有行按「父 id + 名称」索引
    const existingByParentName = new Map<string, number>();
    for (const row of existingRows)
      existingByParentName.set(`${row.parentId ?? "root"}${SEP}${row.name}`, row.id);

    const takenIds = new Set(existingRows.map((r) => r.id));
    const resolvedId = new Map<PathKey, number>(); // path -> 最终 id（已存在或将创建）
    type Plan = {
      path: string[];
      level: number;
      parentKey: PathKey | null;
      id: number | null;
      slug: string | null;
      reason: string;
    };
    const plans: Plan[] = [];
    let reuseCount = 0;

    for (const node of ordered) {
      const k = keyOf(node.path);
      const parentKey = node.path.length > 1 ? keyOf(node.path.slice(0, -1)) : null;
      const parentId = parentKey ? (resolvedId.get(parentKey) ?? null) : null;
      if (parentKey && parentId === null) {
        // 父节点将新建但 id 未定（自增）：延后到执行阶段解析，这里先占位
      }
      const name = node.path[node.path.length - 1];
      const existingId =
        parentId !== null || !parentKey
          ? existingByParentName.get(`${parentId ?? "root"}${SEP}${name}`)
          : undefined;
      if (existingId !== undefined) {
        resolvedId.set(k, existingId);
        reuseCount++;
        continue;
      }
      const wantedId = bestVote(node.idVotes);
      const id = wantedId !== undefined && !takenIds.has(wantedId) ? wantedId : null;
      if (id !== null) takenIds.add(id);
      const slug = bestVote(node.slugVotes) ?? null;
      plans.push({
        path: node.path,
        level: node.path.length,
        parentKey,
        id,
        slug,
        reason:
          id !== null
            ? "原始 id"
            : wantedId !== undefined
              ? `原始 id ${wantedId} 已被占用，改用自增`
              : "无原始 id，自增",
      });
      if (id !== null) resolvedId.set(k, id);
    }

    console.log(
      `\n路径来源汇总: 现有标签 ${existingRows.length} 行, 队列记录 ${queueItems.length}, 审核项 ${auditItems.length}, 素材 ${assets.length}, 特征绑定 ${logoTags.length + ipTags.length + productTags.length + personTags.length}`,
    );
    console.log(
      `重建出的树共 ${nodes.size} 个节点：复用现有 ${reuseCount}，需新建 ${plans.length}（其中按原始 id 插入 ${plans.filter((p) => p.id !== null).length}）`,
    );
    const byLevel = [1, 2, 3]
      .map((l) => `L${l}=${plans.filter((p) => p.level === l).length}`)
      .join(" ");
    console.log(`需新建按层级: ${byLevel}`);
    for (const p of plans) {
      console.log(
        `  + ${p.path.join(" > ")}  id=${p.id ?? "auto"}  slug=${p.slug ?? "-"}  (${p.reason})`,
      );
    }

    // 待回填的外键数量
    const auditNull = auditItems.filter((a) => a.leafTagId === null).length;
    const featureNull = [...logoTags, ...ipTags, ...productTags, ...personTags].filter(
      (t) => t.assetTagId === null,
    ).length;
    console.log(
      `\n待回填: 审核项 leafTagId 为空 ${auditNull} 条，特征库绑定 assetTagId 为空 ${featureNull} 条`,
    );

    if (out) {
      const tree = ordered.map((n) => ({
        path: n.path,
        finalId: resolvedId.get(keyOf(n.path)) ?? null,
        idVotes: Object.fromEntries(n.idVotes),
        slugVotes: Object.fromEntries(n.slugVotes),
        sources: [...n.sources],
      }));
      await writeFile(out, JSON.stringify(tree, null, 2));
      console.log(`已导出到 ${out}`);
    }

    if (!apply) {
      console.log("\n(dry-run，未写库。确认无误后加 --apply)");
      return;
    }

    // ---------- 3. 写库：按层级创建 ----------
    let created = 0;
    for (const p of plans) {
      const parentId = p.parentKey ? resolvedId.get(p.parentKey) : null;
      if (p.parentKey && (parentId === undefined || parentId === null)) {
        throw new Error(`父节点未解析: ${p.path.join(" > ")}`);
      }
      const data: Prisma.AssetTagUncheckedCreateInput = {
        teamId,
        name: p.path[p.level - 1],
        level: p.level,
        parentId: parentId ?? null,
        slug: p.slug,
        ...(p.id !== null ? { id: p.id } : {}),
      };
      const row = await prisma.assetTag.create({ data });
      resolvedId.set(keyOf(p.path), row.id);
      created++;
    }
    // 显式插入过 id 后把序列拨到 max(id)，避免后续自增撞上
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"AssetTag"', 'id'), COALESCE((SELECT MAX(id) FROM "AssetTag"), 1))`,
    );
    console.log(`\n已创建 ${created} 个标签，序列已对齐`);

    // ---------- 4. 回填外键 ----------
    const idByPath = (path: unknown): number | undefined =>
      isStringArray(path) ? resolvedId.get(keyOf(path)) : undefined;

    let auditFixed = 0;
    for (const a of auditItems) {
      if (a.leafTagId !== null) continue;
      const id = idByPath(a.tagPath);
      if (id === undefined) continue;
      await prisma.taggingAuditItem.update({ where: { id: a.id }, data: { leafTagId: id } });
      auditFixed++;
    }
    console.log(`审核项 leafTagId 回填 ${auditFixed} / ${auditNull}`);

    const relink = async <T extends { id: string; tagPath: unknown; assetTagId: number | null }>(
      label: string,
      rows: T[],
      update: (id: string, assetTagId: number) => Promise<unknown>,
    ) => {
      let fixed = 0;
      let total = 0;
      for (const r of rows) {
        if (r.assetTagId !== null) continue;
        total++;
        const id = idByPath(r.tagPath);
        if (id === undefined) continue;
        try {
          await update(r.id, id);
          fixed++;
        } catch (error) {
          // 同一特征已有指向该标签的另一行时会撞 unique，跳过即可
          console.warn(
            `  ${label} ${r.id} 回填失败: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
          );
        }
      }
      console.log(`${label} assetTagId 回填 ${fixed} / ${total}`);
    };
    await relink("品牌 logo 绑定", logoTags, (id, assetTagId) =>
      prisma.assetLogoTag.update({ where: { id }, data: { assetTagId } }),
    );
    await relink("IP 绑定", ipTags, (id, assetTagId) =>
      prisma.assetIpTag.update({ where: { id }, data: { assetTagId } }),
    );
    await relink("商品绑定", productTags, (id, assetTagId) =>
      prisma.assetProductTag.update({ where: { id }, data: { assetTagId } }),
    );
    await relink("人物绑定", personTags, (id, assetTagId) =>
      prisma.assetPersonTag.update({ where: { id }, data: { assetTagId } }),
    );

    console.log(
      "\n完成。下一步：到标签管理页点「手动同步当前标签树到 MuseDAM」把新恢复的标签推上去；再手动补标签的关键词 / 互斥 / 必打等配置。",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
