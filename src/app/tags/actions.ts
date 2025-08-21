"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { Tag } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function fetchTeamTags(): Promise<
  ServerActionResult<{
    tags: Tag[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    console.log(teamId);
    const tags = await prisma.assetTag.findMany({
      where: {
        teamId,
        parentId: {
          equals: null,
        },
      },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      include: {
        parent: true,
        children: {
          orderBy: { name: "asc" },
          include: {
            children: {
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: { tags },
    };
  });
}
