import { idToSlug } from "@/lib/slug";
import { bumpTagConfigVersion } from "@/lib/tagging/tag-config-version";
import { assertTagImportOwnership } from "@/lib/tagging/tag-import-lock";
import { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { z } from "zod";
import { retrieveTeamCredentials } from "../apiKey";
import { requestMuseDAMAPI } from "../lib";
import { MuseDAMID } from "../types";

export const TAG_TREE_IMPORT_MAX_NODES = 20000;
type TreeNode = { name: string; nameChildList?: TreeNode[] };
type RequestNode = { clientId: string; name: string; children: RequestNode[] };
const resultSchema = z.object({
  requestId: z.string(),
  mode: z.enum(["merge", "overwrite"]).optional(),
  createdCount: z.number().int().nonnegative(),
  reusedCount: z.number().int().nonnegative(),
  nodes: z.array(
    z.object({
      clientId: z.string(),
      id: z.string().regex(/^[1-9]\d*$/),
      parentId: z.string().regex(/^\d+$/),
      name: z.string(),
      sort: z.number().int(),
      created: z.boolean(),
    }),
  ),
});
type Result = z.infer<typeof resultSchema>;
type Receipt = {
  requestId: string;
  state: "pending" | "remoteCommitted" | "localSaved";
  nodes: RequestNode[];
  result?: Result;
  imported: boolean;
  mode?: "merge" | "overwrite";
};

export function buildTagTreeImportRequest(tree: TreeNode[]): RequestNode[] {
  if (!tree.length) throw new Error("标签树不能为空");
  let count = 0;
  const walk = (nodes: TreeNode[], prefix: string, depth: number): RequestNode[] =>
    nodes.map((node, index) => {
      if (depth > 4 || ++count > TAG_TREE_IMPORT_MAX_NODES)
        throw new Error(`标签树最多 4 级、${TAG_TREE_IMPORT_MAX_NODES} 个节点（包含父节点）`);
      const clientId = `${prefix}.${index}`;
      return {
        clientId,
        name: node.name.trim(),
        children: walk(node.nameChildList ?? [], clientId, depth + 1),
      };
    });
  return walk(tree, "n", 1);
}

/** 主仓同步提交；持久回执独立保存，随后本地标签和完成状态共同提交。失败后同内容复用未完成请求。 */
export async function importTagTreeSynchronously(
  team: { id: number; slug: string },
  tree: TreeNode[],
  imported = false,
  mode: "merge" | "overwrite" = "merge",
) {
  const nodes = buildTagTreeImportRequest(tree);
  const hash = createHash("sha256")
    .update(JSON.stringify({ nodes, imported, ...(mode === "overwrite" ? { mode } : {}) }))
    .digest("hex");
  const key = `tag-tree-import:${hash}`;
  const where = { teamId_key: { teamId: team.id, key } };
  const receipt = await prisma.$transaction(async (tx) => {
    await assertTagImportOwnership(tx);
    // 每个团队/载荷串行登记，同进程或多进程并发重试复用一个请求号；不跨网络持有锁。
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${team.id}::int, ${parseInt(hash.slice(0, 7), 16)}::int)::text`;
    const previous = await tx.teamConfig.findUnique({ where });
    const saved = previous?.value as unknown as Receipt | undefined;
    if (saved && saved.state !== "localSaved") return saved;
    const next: Receipt = {
      requestId: `tag-tree-${randomUUID()}`,
      state: "pending",
      nodes,
      imported,
      mode,
    };
    await tx.teamConfig.upsert({
      where,
      create: { teamId: team.id, key, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  });
  let result = receipt.result;
  if (!result) {
    const { apiKey } = await retrieveTeamCredentials({ team });
    // 同号重放既能恢复超时未知结果，也能直接取回已提交回执，不退回多次 merge-tags。
    result = resultSchema.parse(
      await requestMuseDAMAPI("/api/muse/import-tag-tree", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { requestId: receipt.requestId, tags: receipt.nodes, mode: receipt.mode ?? "merge" },
        timeoutMs: 75_000,
      }),
    );
    if (result.requestId !== receipt.requestId)
      throw new Error("MuseDAM returned a different import request ID");
    if ((result.mode ?? "merge") !== mode)
      throw new Error("主仓未确认原子覆盖模式，请核对主仓版本后重试。");
    validateMappings(receipt.nodes, result);
    const remote: Receipt = { ...receipt, state: "remoteCommitted", result };
    await prisma.teamConfig.updateMany({
      where: { teamId: team.id, key, value: { path: ["requestId"], equals: receipt.requestId } },
      data: { value: remote as unknown as Prisma.InputJsonValue },
    });
  }
  if ((result.mode ?? "merge") !== mode)
    throw new Error("主仓未确认原子覆盖模式，请核对主仓版本后重试。");
  validateMappings(receipt.nodes, result);
  const mapping = new Map(result.nodes.map((node) => [node.clientId, node]));
  await prisma.$transaction(
    async (tx) => {
      await assertTagImportOwnership(tx);
      // 串行本地补存，保留已有 ID/extra；父级落库后再存子级，避免 ID 混用。
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${team.id}::int, ${parseInt(hash.slice(0, 7), 16)}::int)::text`;
      const current = await tx.teamConfig.findUnique({ where });
      if ((current?.value as unknown as Receipt | undefined)?.requestId !== receipt.requestId)
        throw new Error("导入记录已变化，请重新导入以核对结果");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${team.id}::int, 5521735::int)::text`;
      const localKey = (parentId: number | null, name: string) => JSON.stringify([parentId, name]);
      const loadIndex = async () =>
        new Map(
          (
            await tx.assetTag.findMany({
              where: { teamId: team.id },
              select: { id: true, parentId: true, name: true },
            })
          ).map((tag) => [localKey(tag.parentId, tag.name), tag]),
        );
      // Reuse matching local IDs and configuration in both modes. Prune only after all mappings exist.
      const retainedIds: number[] = [];
      let index = await loadIndex();
      let level = receipt.nodes.map((node) => ({
        node,
        parentId: null as number | null,
        depth: 1,
      }));
      while (level.length) {
        const missing = level.filter(
          ({ node, parentId }) => !index.has(localKey(parentId, node.name)),
        );
        for (let offset = 0; offset < missing.length; offset += 500) {
          const data = missing.slice(offset, offset + 500).map(({ node, parentId, depth }) => {
            const remote = mapping.get(node.clientId)!;
            return {
              teamId: team.id,
              parentId,
              level: depth,
              name: remote.name,
              slug: idToSlug("assetTag", new MuseDAMID(remote.id)),
              sort: remote.sort,
              ...(imported ? { extra: { configurationSource: "import" } } : {}),
            };
          });
          const created = await tx.assetTag.createManyAndReturn({
            data,
            skipDuplicates: true,
            select: { id: true, parentId: true, name: true },
          });
          for (const tag of created) index.set(localKey(tag.parentId, tag.name), tag);
          if (created.length < data.length) index = await loadIndex();
        }
        const patches = level.map(({ node, parentId }) => {
          const local = index.get(localKey(parentId, node.name));
          if (!local) throw new Error("Local tag mapping missing after insert");
          const remote = mapping.get(node.clientId)!;
          retainedIds.push(local.id);
          return {
            id: local.id,
            slug: idToSlug("assetTag", new MuseDAMID(remote.id)),
            sort: remote.sort,
          };
        });
        for (let offset = 0; offset < patches.length; offset += 500) {
          const payload = JSON.stringify(patches.slice(offset, offset + 500));
          await tx.$executeRaw`UPDATE "AssetTag" AS t SET "slug" = p.slug, "sort" = p.sort,
          "extra" = CASE WHEN ${imported} THEN (CASE WHEN jsonb_typeof(t."extra") = 'object' THEN t."extra" ELSE '{}'::jsonb END) || '{"configurationSource":"import"}'::jsonb ELSE t."extra" END,
          "updatedAt" = now()
          FROM jsonb_to_recordset(${payload}::jsonb) AS p(id int, slug text, sort int)
          WHERE t."id" = p.id AND t."teamId" = ${team.id}`;
        }
        level = level.flatMap(({ node, parentId, depth }) =>
          node.children.map((child) => ({
            node: child,
            parentId: index.get(localKey(parentId, node.name))!.id,
            depth: depth + 1,
          })),
        );
      }
      if (mode === "overwrite") {
        await tx.assetTag.deleteMany({ where: { teamId: team.id, id: { notIn: retainedIds } } });
      }
      await tx.teamConfig.update({
        where,
        data: {
          value: { ...receipt, result, state: "localSaved" } as unknown as Prisma.InputJsonValue,
        },
      });
      await bumpTagConfigVersion(tx, team.id);
    },
    { timeout: 60_000, isolationLevel: "ReadCommitted" },
  );
}

function validateMappings(nodes: RequestNode[], result: Result) {
  const expected = new Map<string, { node: RequestNode; parent?: string }>();
  const walk = (items: RequestNode[], parent?: string) => {
    for (const node of items) {
      expected.set(node.clientId, { node, parent });
      walk(node.children, node.clientId);
    }
  };
  walk(nodes);
  const actual = new Map(result.nodes.map((node) => [node.clientId, node]));
  if (actual.size !== expected.size || actual.size !== result.nodes.length)
    throw new Error("Incomplete MuseDAM import result");
  for (const [id, { node, parent }] of expected) {
    const mapped = actual.get(id);
    if (
      !mapped ||
      mapped.name !== node.name ||
      mapped.parentId !== (parent ? actual.get(parent)?.id : "0")
    )
      throw new Error("Invalid MuseDAM import node mapping");
  }
}
