import { rootLogger } from "@/lib/logging";
import { idToSlug, slugToId } from "@/lib/slug";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { fetchMuseDAMUser } from "@/musedam/user";
import prisma from "@/prisma/prisma";
import { after } from "next/server";
import "server-only";
import { getAccessPermissions } from "../(tagging)/tagging/access/lib";

export async function createUserAndTeam(payload: {
  user: { name: string; slug: string };
  team: { id?: number; name: string; slug: string };
}) {
  // 先查找用户和团队是否已存在
  const [existingUser, existingTeam] = await Promise.all([
    prisma.user.findUnique({ where: { slug: payload.user.slug } }),
    payload.team.id
      ? prisma.team.findUnique({ where: { id: payload.team.id } })
      : prisma.team.findUnique({ where: { slug: payload.team.slug } }),
  ]);

  const { user, team } = await prisma.$transaction(async (tx) => {
    // 如果用户不存在，创建用户
    const user =
      existingUser ||
      (await tx.user.create({
        data: {
          name: payload.user.name,
          slug: payload.user.slug,
        },
      }));

    // 如果团队不存在，创建团队
    const team =
      existingTeam ||
      (await tx.team.create({
        data: {
          name: payload.team.name,
          slug: payload.team.slug,
        },
      }));

    // 检查成员关系是否已存在
    const existingMembership = await tx.membership.findUnique({
      where: {
        userId_teamId: {
          userId: user.id,
          teamId: team.id,
        },
      },
    });

    // 如果成员关系不存在，创建成员关系
    if (!existingMembership) {
      await tx.membership.create({
        data: {
          userId: user.id,
          teamId: team.id,
        },
      });
    }

    return { user, team };
  });

  // TODO: 如果同时打开两个页面都在创建 team，这里可能会出现冲突，有一个办法是在 teamconfig 里添加一个 loading 标记
  // 第一次创建团队，需要同步标签数据（在事务外执行）
  if (!existingTeam) {
    rootLogger.info(`Team ${payload.team.slug} initialized, syncing tags from MuseDAM`);
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
    user: { id: user.id, slug: user.slug },
    team: { id: team.id, slug: team.slug },
  };
}

export async function checkUserPermission(payload: {
  user: { id: number; slug: string };
  team: { id: number; slug: string };
}) {
  const musedamUserId = slugToId("user", payload.user.slug);
  const result = await fetchMuseDAMUser({
    team: payload.team,
    musedamUserId,
  });

  // First check if user has admin or content role in MuseDAM
  if (result.roleCode === "admin" || result.roleCode === "content") {
    return result;
  }

  // If not, check access permissions configuration
  const permissions = await getAccessPermissions(payload.team.id);

  if (permissions.length > 0) {
    // Check if user has direct permission
    const userSlug = payload.user.slug;
    const userPermission = permissions.find((p) => p.slug === userSlug);
    if (userPermission) {
      return { ...result, accessRole: userPermission.role };
    }

    // Check if user's department has permission
    if (result.departmentIds && result.departmentIds.length > 0) {
      for (const deptId of result.departmentIds) {
        const deptSlug = idToSlug("department", deptId);
        const deptPermission = permissions.find((p) => p.slug === deptSlug);
        if (deptPermission) {
          return { ...result, accessRole: deptPermission.role };
        }
      }
    }

    // Check if user's group has permission
    if (result.groupIds && result.groupIds.length > 0) {
      for (const groupId of result.groupIds) {
        const groupSlug = idToSlug("group", groupId);
        const groupPermission = permissions.find((p) => p.slug === groupSlug);
        if (groupPermission) {
          return { ...result, accessRole: groupPermission.role };
        }
      }
    }
  }

  throw new Error("Permission denied");
}
