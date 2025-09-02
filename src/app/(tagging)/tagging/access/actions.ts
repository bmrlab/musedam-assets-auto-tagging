"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { AccessPermission } from "@/app/(tagging)/types";
import { ServerActionResult } from "@/lib/serverAction";
import { revalidatePath } from "next/cache";
import {
  addOrUpdateAccessPermission,
  getAccessPermissions,
  removeAccessPermission,
  saveAccessPermissions,
} from "./lib";

// 获取权限设置
export async function fetchAccessPermissionsAction(): Promise<
  ServerActionResult<{
    permissions: AccessPermission[];
  }>
> {
  return withAuth(async ({ team }) => {
    try {
      const permissions = await getAccessPermissions(team.id);

      return {
        success: true,
        data: { permissions },
      };
    } catch (error) {
      console.error("获取权限设置失败:", error);
      return {
        success: false,
        message: "获取权限设置失败",
      };
    }
  });
}

// 更新权限设置
export async function updateAccessPermissions(
  permissions: AccessPermission[],
): Promise<ServerActionResult<{ success: boolean }>> {
  return withAuth(async ({ team }) => {
    try {
      await saveAccessPermissions(team.id, permissions);

      revalidatePath("/tagging/access");

      return {
        success: true,
        data: { success: true },
      };
    } catch (error) {
      console.error("保存权限设置失败:", error);
      return {
        success: false,
        message: "保存权限设置失败",
      };
    }
  });
}

// 添加权限
export async function addAccessPermissionAction(
  permission: AccessPermission,
): Promise<ServerActionResult<{ permissions: AccessPermission[] }>> {
  return withAuth(async ({ team }) => {
    try {
      const newPermissions = await addOrUpdateAccessPermission(team.id, permission);

      revalidatePath("/tagging/access");

      return {
        success: true,
        data: { permissions: newPermissions },
      };
    } catch (error) {
      console.error("添加权限失败:", error);
      return {
        success: false,
        message: "添加权限失败",
      };
    }
  });
}

// 删除权限
export async function removeAccessPermissionAction(
  slug: string,
): Promise<ServerActionResult<{ permissions: AccessPermission[] }>> {
  return withAuth(async ({ team }) => {
    try {
      const newPermissions = await removeAccessPermission(team.id, slug);

      revalidatePath("/tagging/access");

      return {
        success: true,
        data: { permissions: newPermissions },
      };
    } catch (error) {
      console.error("删除权限失败:", error);
      return {
        success: false,
        message: "删除权限失败",
      };
    }
  });
}
