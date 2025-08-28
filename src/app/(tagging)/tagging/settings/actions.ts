"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { revalidatePath } from "next/cache";
import { SettingsData } from "./types";
import { getSettings, saveSettings, resetSettings } from "./lib";

// 获取设置数据
export async function fetchSettings(): Promise<
  ServerActionResult<{
    settings: SettingsData;
  }>
> {
  return withAuth(async ({ team }) => {
    try {
      const settings = await getSettings(team.id);
      return {
        success: true,
        data: { settings },
      };
    } catch (error) {
      console.error("获取设置失败:", error);
      return {
        success: false,
        message: "获取设置失败",
      };
    }
  });
}

// 更新设置
export async function updateSettings(
  data: SettingsData,
): Promise<ServerActionResult<{ success: boolean }>> {
  return withAuth(async ({ team }) => {
    try {
      await saveSettings(team.id, data);

      // 重新验证页面缓存
      revalidatePath("/tagging/settings");

      return {
        success: true,
        data: { success: true },
      };
    } catch (error) {
      console.error("保存设置失败:", error);
      return {
        success: false,
        message: "保存设置失败",
      };
    }
  });
}

// 重置设置为默认值
export async function resetSettingsAction(): Promise<
  ServerActionResult<{
    settings: SettingsData;
  }>
> {
  return withAuth(async ({ team }) => {
    try {
      const defaultSettings = await resetSettings(team.id);

      revalidatePath("/tagging/settings");

      return {
        success: true,
        data: { settings: defaultSettings },
      };
    } catch (error) {
      console.error("重置设置失败:", error);
      return {
        success: false,
        message: "重置设置失败",
      };
    }
  });
}

// 获取标签体系数据（用于"管理标签体系"功能）
export async function fetchTagSystem(): Promise<
  ServerActionResult<{
    tagSystem: Record<string, unknown>[];
  }>
> {
  return withAuth(async () => {
    try {
      // TODO: 从数据库获取标签体系数据
      // const tagSystem = await prisma.tagSystem.findMany({
      //   where: { teamId },
      //   include: { tags: true },
      // });

      return {
        success: true,
        data: { tagSystem: [] },
      };
    } catch (error) {
      console.error("获取标签体系失败:", error);
      return {
        success: false,
        message: "获取标签体系失败",
      };
    }
  });
}
