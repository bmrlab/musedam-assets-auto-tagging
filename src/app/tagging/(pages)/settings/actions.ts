"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// 定义设置数据的schema
const SettingsSchema = z.object({
  isTaggingEnabled: z.boolean(),
  taggingMode: z.enum(["direct", "review"]),
  recognitionMode: z.enum(["precise", "balanced", "broad"]),
  matchingStrategies: z.object({
    filePath: z.boolean(),
    materialName: z.boolean(),
    materialContent: z.boolean(),
    tagKeywords: z.boolean(),
    multiLanguage: z.boolean(),
  }),
});

export type SettingsData = z.infer<typeof SettingsSchema>;

// 获取设置数据
export async function fetchSettings(): Promise<
  ServerActionResult<{
    settings: SettingsData;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // TODO: 从数据库或配置文件获取实际设置
      // 这里返回默认设置作为示例
      const settings: SettingsData = {
        isTaggingEnabled: true,
        taggingMode: "review",
        recognitionMode: "balanced",
        matchingStrategies: {
          filePath: true,
          materialName: true,
          materialContent: true,
          tagKeywords: true,
          multiLanguage: false,
        },
      };

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
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // TODO: 保存设置到数据库
      // 这里可以添加数据库保存逻辑
      // await prisma.teamSettings.upsert({
      //   where: { teamId },
      //   update: data,
      //   create: { teamId, ...data },
      // });

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
export async function resetSettings(): Promise<
  ServerActionResult<{
    settings: SettingsData;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const defaultSettings: SettingsData = {
        isTaggingEnabled: true,
        taggingMode: "review",
        recognitionMode: "balanced",
        matchingStrategies: {
          filePath: true,
          materialName: true,
          materialContent: true,
          tagKeywords: true,
          multiLanguage: false,
        },
      };

      // TODO: 保存默认设置到数据库
      // await prisma.teamSettings.upsert({
      //   where: { teamId },
      //   update: defaultSettings,
      //   create: { teamId, ...defaultSettings },
      // });

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
    tagSystem: any[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
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
