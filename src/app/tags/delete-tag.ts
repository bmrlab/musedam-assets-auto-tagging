"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import prisma from "@/prisma/prisma";
import { buildCascadeDeletionTree, buildTagDeletionPlan, deletionLayers } from "./delete-tag-plan";

export async function deleteTagAndDescendants(tagId: number): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const rows = await prisma.assetTag.findMany({ where: { teamId } });
      const plan = buildTagDeletionPlan(rows, tagId);
      const affected = [plan.target, ...plan.descendants];
      if (affected.some((row) => row.slug)) {
        const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
        await syncTagsToMuseDAM({
          team: { id: teamId, slug: team.slug },
          tagsTree: buildCascadeDeletionTree(rows, plan),
        });
      }

      await prisma.$transaction(
        async (tx) => {
          // Children first. One statement for the whole subtree lets SET NULL
          // promote still-living descendants into roots and hit the root-name index.
          for (const ids of deletionLayers(plan)) {
            await tx.assetTag.deleteMany({ where: { teamId, id: { in: ids } } });
          }
        },
        { timeout: 20_000 },
      );
      return { success: true, data: undefined };
    } catch (error) {
      console.error("Delete tag error:", error);
      return { success: false, message: error instanceof Error ? error.message : "删除标签失败" };
    }
  });
}
