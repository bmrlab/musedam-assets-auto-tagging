"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import prisma from "@/prisma/prisma";
import { buildCascadeDeletionTree, buildTagDeletionPlan } from "./delete-tag-plan";

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

      await prisma.$transaction(async (tx) => {
        // The local FK uses SET NULL, so descendants must be deleted explicitly.
        await tx.assetTag.deleteMany({
          where: { teamId, id: { in: affected.map((row) => row.id) } },
        });
      });
      return { success: true, data: undefined };
    } catch (error) {
      console.error("Delete tag error:", error);
      return { success: false, message: error instanceof Error ? error.message : "删除标签失败" };
    }
  });
}
