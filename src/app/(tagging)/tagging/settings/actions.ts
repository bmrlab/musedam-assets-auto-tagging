"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { TaggingSettingsData, taggingSettingsSchema } from "@/app/(tagging)/types";
import { ServerActionResult } from "@/lib/serverAction";
import { getTaggingSettings, resetTaggingSettings, saveTaggingSettings } from "./lib";

// 获取设置数据
export async function fetchSettings(): Promise<
  ServerActionResult<{
    settings: TaggingSettingsData;
  }>
> {
  return withAuth(async ({ team, user }) => {
    try {
      const settings = await getTaggingSettings(team.id);
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
  data: TaggingSettingsData,
): Promise<ServerActionResult<{ success: boolean }>> {
  return withAuth(async ({ team, user }) => {
    // 权重直接参与计分，越界值（如 0 或负数）会导致得分异常，必须在服务端拦截
    if (!taggingSettingsSchema.shape.sourceWeights.safeParse(data.sourceWeights).success) {
      return {
        success: false,
        message: "匹配策略权重不合法",
      };
    }
    if (data.featureImageMode !== undefined &&
        !taggingSettingsSchema.shape.featureImageMode.safeParse(data.featureImageMode).success) {
      return { success: false, message: "图像模式设置不合法" };
    }
    if (data.featureVideoImageMode !== undefined &&
        !taggingSettingsSchema.shape.featureVideoImageMode.safeParse(data.featureVideoImageMode).success) {
      return { success: false, message: "视频图像模式设置不合法" };
    }
    try {
      const parsed = taggingSettingsSchema.parse(data);
      if (parsed.applicationScope.scopeType === "all") parsed.applicationScope.selectedFolders = [];
      await saveTaggingSettings(team.id, parsed, user.slug);

      // 不需要 revalidatePath，因为：
      // 1. 客户端状态已经通过 useState 更新
      // 2. 没有其他页面依赖这个路径的缓存
      // 3. revalidatePath 会导致页面刷新时的语言切换问题

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
    settings: TaggingSettingsData;
  }>
> {
  return withAuth(async ({ team, user }) => {
    try {
      const defaultSettings = await resetTaggingSettings(team.id, user.slug);

      // 不需要 revalidatePath（同 updateSettings 的原因）

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
