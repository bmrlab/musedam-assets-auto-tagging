import { rootLogger } from "@/lib/logging";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import prisma from "@/prisma/prisma";
import { after } from "next/server";
import "server-only";

export async function createUserAndTeam(payload: {
  user: { name: string; slug: string };
  team: { id?: number; name: string; slug: string };
}) {
  const { user, team } = await prisma.$transaction(async (tx) => {
    const [user, team] = await Promise.all([
      tx.user.create({
        data: {
          name: payload.user.name,
          slug: payload.user.slug,
        },
      }),
      !payload.team.id
        ? tx.team.create({
            data: {
              name: payload.team.name,
              slug: payload.team.slug,
            },
          })
        : Promise.resolve({
            id: payload.team.id,
            slug: payload.team.slug,
          }),
    ]);
    await tx.membership.create({
      data: {
        userId: user.id,
        teamId: team.id,
      },
    });
    return { user, team };
  });
  // TODO: 如果同时打开两个页面都在创建 team，这里可能会出现冲突，有一个办法是在 teamconfig 里添加一个 loading 标记
  if (!payload.team.id) {
    rootLogger.info(`Team ${payload.team.slug} created, syncing tags from MuseDAM`);
    after(
      syncTagsFromMuseDAM({
        team: {
          id: team.id,
          slug: team.slug,
        },
      }),
    );
  }
  return {
    user: { id: user.id },
    team: { id: team.id },
  };
}
