"use server";
import { withTagMutation } from "./tagMutation";

import { bumpTagConfigVersion } from "@/lib/tagging/tag-config-version";
import type { ServerActionResult } from "@/lib/serverAction";
import { softDeleteTagSubtree } from "@/lib/tagging/soft-delete-tags";
import { assertTagImportOwnership, runTagImportExclusive } from "@/lib/tagging/tag-import-lock";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import prisma from "@/prisma/prisma";
import { buildCascadeDeletionTree, buildTagDeletionPlan, type DeletableTag } from "./delete-tag-plan";

export async function deleteTagAndDescendants(tagId: number): Promise<ServerActionResult<void>> {
  return withTagMutation(async ({ user, team: { id: teamId } }) => {
    try {
      return await runTagImportExclusive(teamId, user.id, async () => {
        // 只读取目标子树和祖先，不因删除一个叶节点加载整个团队的标签。
        // UNION 去重使异常循环关系也能终止，后续计划校验仍负责拒绝循环。
        const rows = await prisma.$queryRaw<DeletableTag[]>`WITH RECURSIVE target AS (
          SELECT "id", "name", "slug", "parentId", "level", "sort" FROM "AssetTag"
          WHERE "teamId" = ${teamId} AND "id" = ${tagId} AND "deletedAt" IS NULL
        ), descendants AS (
          SELECT * FROM target
          UNION
          SELECT child."id", child."name", child."slug", child."parentId", child."level", child."sort"
          FROM "AssetTag" child JOIN descendants parent ON child."parentId" = parent."id"
          WHERE child."teamId" = ${teamId} AND child."deletedAt" IS NULL
        ), ancestors AS (
          SELECT * FROM target
          UNION
          SELECT parent."id", parent."name", parent."slug", parent."parentId", parent."level", parent."sort"
          FROM "AssetTag" parent JOIN ancestors child ON parent."id" = child."parentId"
          WHERE parent."teamId" = ${teamId} AND parent."deletedAt" IS NULL
        ) SELECT * FROM descendants UNION SELECT * FROM ancestors`;
        const plan = buildTagDeletionPlan(rows, tagId);
        const affected = [plan.target, ...plan.descendants];
        if (affected.some((row) => row.slug)) {
          const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
          await syncTagsToMuseDAM({
            team: { id: teamId, slug: team.slug },
            tagsTree: buildCascadeDeletionTree(rows, plan),
          });
        }

        await prisma.$transaction(async (tx) => {
          await assertTagImportOwnership(tx);
          await softDeleteTagSubtree(tx, teamId, tagId);
          await bumpTagConfigVersion(tx, teamId);
        });
        return { success: true as const, data: undefined };
      });
    } catch (error) {
      console.error("Delete tag error:", error);
      return { success: false, message: error instanceof Error ? error.message : "删除标签失败" };
    }
  });
}
