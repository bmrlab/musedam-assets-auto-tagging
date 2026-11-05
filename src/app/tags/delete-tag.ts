"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import { deleteTagsWithinBudget } from "@/lib/tagging/delete-tag-batches";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import prisma from "@/prisma/prisma";
import { buildCascadeDeletionTree, buildTagDeletionPlan } from "./delete-tag-plan";

export async function deleteTagAndDescendants(
  tagId: number,
  localOnly = false,
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const rows = await prisma.assetTag.findMany({ where: { teamId } });
      const plan = buildTagDeletionPlan(rows, tagId);
      const affected = [plan.target, ...plan.descendants];
      if (!localOnly && affected.some((row) => row.slug)) {
        const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
        await syncTagsToMuseDAM({
          team: { id: teamId, slug: team.slug },
          tagsTree: buildCascadeDeletionTree(rows, plan),
        });
      }

      const done = await deleteTagsWithinBudget(
        teamId,
        affected.map((row) => ({ id: row.id, parentId: row.parentId })),
      );
      if (!done) {
        return { success: false, code: "continue", message: "子标签较多，正在继续删除" };
      }
      return { success: true, data: undefined };
    } catch (error) {
      console.error("Delete tag error:", error);
      return { success: false, message: error instanceof Error ? error.message : "删除标签失败" };
    }
  });
}
