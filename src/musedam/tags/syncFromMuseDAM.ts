import "server-only";

import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import type { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { randomUUID } from "node:crypto";
import { MuseDAMID } from "../types";

type MuseDAMTagTree = {
  id: MuseDAMID;
  name: string;
  sort: number;
  children: MuseDAMTagTree | null;
}[];

type SyncNode = {
  name: string;
  slug: string;
  sort: number;
  children: SyncNode[];
};

type PlannedTag = {
  node: SyncNode;
  existing?: AssetTag;
  parent: PlannedTag | null;
  level: number;
  id?: number;
};

/** Validate the complete response before making any local changes. */
function readTagTree(value: unknown, slugs = new Set<string>()): SyncNode[] {
  if (!Array.isArray(value)) throw new Error("Invalid MuseDAM tag tree");
  const siblingNames = new Set<string>();
  return value.map((node) => {
    if (
      !node ||
      typeof node !== "object" ||
      typeof node.name !== "string" ||
      !node.name.trim() ||
      node.name.length > 100 ||
      !/^\d+$/.test(String(node.id)) ||
      BigInt(String(node.id)) <= BigInt(0) ||
      (node.sort !== undefined &&
        (!Number.isInteger(node.sort) || node.sort < -2147483648 || node.sort > 2147483647)) ||
      siblingNames.has(node.name)
    ) {
      throw new Error("Invalid MuseDAM tag tree");
    }
    siblingNames.add(node.name);
    const slug = idToSlug("assetTag", MuseDAMID.from(node.id));
    if (slugs.has(slug)) throw new Error("Duplicate MuseDAM tag id");
    slugs.add(slug);
    return {
      name: node.name,
      slug,
      sort: node.sort ?? 0,
      children: node.children == null ? [] : readTagTree(node.children, slugs),
    };
  });
}

/**
 * 按 MuseDAM ID 优先、同父级同名兜底匹配，保留已有 AssetTag 的 id、配置和关联。
 * 改名、移动也更新原行；只新增缺失标签、删除 MuseDAM 中已不存在的标签。
 * 整次本地同步在事务中完成，不能因半途失败留下临时名称或不完整的标签树。
 */
export async function syncTagsFromMuseDAM({ team }: { team: { id: number; slug: string } }) {
  const { apiKey } = await retrieveTeamCredentials({ team });
  const result = await requestMuseDAMAPI("/api/muse/query-tag-tree", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { orgId: slugToId("team", team.slug) },
  });
  const nodes = readTagTree(result);
  const incomingSlugs = new Set<string>();
  const collectSlugs = (tree: SyncNode[]) => {
    for (const node of tree) {
      incomingSlugs.add(node.slug);
      collectSlugs(node.children);
    }
  };
  collectSlugs(nodes);

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${team.id}::int, 5521735::int)::text`;
      const tombstones = await tx.assetTag.count({
        where: { teamId: team.id, deletedAt: { not: null }, slug: { in: [...incomingSlugs] } },
      });
      if (tombstones) throw new Error("MuseDAM 返回了已删除的标签，请等待主站同步完成后重试");
      const existingTags = await tx.assetTag.findMany({
        where: { deletedAt: null, teamId: team.id },
      });
      const bySlug = new Map<string, AssetTag>();
      const byPath = new Map<string, AssetTag>();
      const keyOf = (parentId: number | null, name: string) => JSON.stringify([parentId, name]);
      for (const tag of existingTags) {
        if (tag.slug) {
          if (bySlug.has(tag.slug)) throw new Error("Duplicate local MuseDAM tag id");
          bySlug.set(tag.slug, tag);
        }
        byPath.set(keyOf(tag.parentId, tag.name), tag);
      }

      const keptIds = new Set<number>();
      const plan: PlannedTag[] = [];
      const prepare = (tree: SyncNode[], parent: PlannedTag | null, level: number) => {
        for (const node of tree) {
          let existing = bySlug.get(node.slug);
          // A new parent has no existing local children. Never match its child against a root tag.
          if (!existing && (!parent || parent.existing)) {
            const candidate = byPath.get(keyOf(parent?.existing?.id ?? null, node.name));
            // A tag whose MuseDAM ID is still present belongs to that ID, even if it was renamed.
            if (
              candidate &&
              !keptIds.has(candidate.id) &&
              (!candidate.slug || !incomingSlugs.has(candidate.slug))
            ) {
              existing = candidate;
            }
          }
          if (existing) {
            if (keptIds.has(existing.id)) throw new Error("Ambiguous MuseDAM tag match");
            keptIds.add(existing.id);
          }
          const item: PlannedTag = { node, existing, parent, level, id: existing?.id };
          plan.push(item);
          // Do not truncate deeper levels: hidden level-4 data must remain in the local tree.
          prepare(node.children, item, level + 1);
        }
      };
      prepare(nodes, null, 1);

      const changedPositions = new Set(
        plan
          .filter(
            (item) =>
              item.existing &&
              (item.existing.name !== item.node.name ||
                item.existing.parentId !== (item.parent ? item.parent.id : null)),
          )
          .map((item) => item.existing!.id),
      );

      const staleIds = existingTags.filter((tag) => !keptIds.has(tag.id)).map((tag) => tag.id);
      if (staleIds.length)
        await tx.assetTag.updateMany({
          where: { teamId: team.id, deletedAt: null, id: { in: staleIds } },
          data: { deletedAt: new Date() },
        });
      // Free old sibling names before updates, including name swaps and moves into stale paths.
      // Stale parents remain until retained children have moved out, to preserve their relations.
      for (const tag of existingTags) {
        if (changedPositions.has(tag.id)) {
          await tx.assetTag.update({
            where: { deletedAt: null, id: tag.id, teamId: team.id },
            data: { name: `__musedam_sync_${randomUUID()}` },
          });
        }
      }

      for (const item of plan) {
        const data = {
          name: item.node.name,
          slug: item.node.slug,
          sort: item.node.sort,
          level: item.level,
          parentId: item.parent?.id ?? null,
        };
        if (item.existing) {
          const tag = item.existing;
          if (
            changedPositions.has(tag.id) ||
            tag.name !== data.name ||
            tag.slug !== data.slug ||
            tag.sort !== data.sort ||
            tag.level !== data.level ||
            tag.parentId !== data.parentId
          ) {
            await tx.assetTag.update({
              where: { deletedAt: null, id: tag.id, teamId: team.id },
              data,
            });
          }
        } else {
          const created = await tx.assetTag.create({ data: { ...data, teamId: team.id } });
          item.id = created.id;
        }
      }
    },
    { timeout: 60000 },
  );

  return result as MuseDAMTagTree;
}
