"use server";
import { withTagMutation } from "./tagMutation";

import { bumpTagConfigVersion } from "@/lib/tagging/tag-config-version";
import type { ServerActionResult } from "@/lib/serverAction";
import { softDeleteTagSubtree } from "@/lib/tagging/soft-delete-tags";
import { assertTagImportOwnership, runTagImportExclusive } from "@/lib/tagging/tag-import-lock";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import prisma from "@/prisma/prisma";
import { buildCascadeDeletionTree, buildTagDeletionPlan } from "./delete-tag-plan";

export async function deleteTagAndDescendants(tagId: number): Promise<ServerActionResult<void>> {
  return withTagMutation(async ({ user, team: { id: teamId } }) => {
    try {
      return await runTagImportExclusive(teamId, user.id, async () => {
        const rows = await prisma.assetTag.findMany({
          where: { deletedAt: null, teamId },
          select: { id: true, name: true, slug: true, parentId: true, level: true, sort: true },
        });
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
