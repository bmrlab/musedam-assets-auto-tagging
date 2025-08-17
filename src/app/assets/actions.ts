"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetObject } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function fetchTeamAssets(): Promise<
  ServerActionResult<{
    assets: AssetObject[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const assets = await prisma.assetObject.findMany({
      where: { teamId },
      orderBy: [
        { createdAt: 'desc' }
      ],
      take: 10 // 默认前10个
    });

    return {
      success: true,
      data: { assets },
    };
  });
}
