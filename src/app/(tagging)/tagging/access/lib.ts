import "server-only";

import { AccessPermission, TAGGING_CONFIG_KEYS } from "@/app/(tagging)/types";
import prisma from "@/prisma/prisma";

// 获取权限配置数据
export async function getAccessPermissions(teamId: number): Promise<AccessPermission[]> {
  // 从数据库获取团队配置
  const config = await prisma.teamConfig.findUnique({
    where: {
      teamId_key: {
        teamId,
        key: TAGGING_CONFIG_KEYS.ACCESS_PERMISSIONS,
      },
    },
  });

  // 如果没有配置，返回空数组
  if (!config) {
    return [];
  }

  // 返回权限配置数组
  return (config.value as unknown as AccessPermission[]) || [];
}

// 保存权限配置数据
export async function saveAccessPermissions(
  teamId: number,
  permissions: AccessPermission[],
): Promise<void> {
  await prisma.teamConfig.upsert({
    where: {
      teamId_key: {
        teamId,
        key: TAGGING_CONFIG_KEYS.ACCESS_PERMISSIONS,
      },
    },
    create: {
      teamId,
      key: TAGGING_CONFIG_KEYS.ACCESS_PERMISSIONS,
      value: permissions as any,
    },
    update: {
      value: permissions as any,
    },
  });
}

// 添加或更新单个权限
export async function addOrUpdateAccessPermission(
  teamId: number,
  permission: AccessPermission,
): Promise<AccessPermission[]> {
  const currentPermissions = await getAccessPermissions(teamId);
  
  // 检查是否已存在
  const existingIndex = currentPermissions.findIndex(p => p.slug === permission.slug);
  
  let newPermissions: AccessPermission[];
  if (existingIndex >= 0) {
    // 更新现有权限
    newPermissions = [...currentPermissions];
    newPermissions[existingIndex] = permission;
  } else {
    // 添加新权限
    newPermissions = [...currentPermissions, permission];
  }

  await saveAccessPermissions(teamId, newPermissions);
  return newPermissions;
}

// 删除权限
export async function removeAccessPermission(
  teamId: number,
  slug: string,
): Promise<AccessPermission[]> {
  const currentPermissions = await getAccessPermissions(teamId);
  const newPermissions = currentPermissions.filter(p => p.slug !== slug);
  
  await saveAccessPermissions(teamId, newPermissions);
  return newPermissions;
}