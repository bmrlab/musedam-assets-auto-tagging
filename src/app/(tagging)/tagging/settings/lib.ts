import "server-only";

import prisma from "@/prisma/prisma";
import { CONFIG_KEYS, DEFAULT_SETTINGS, SettingsData } from "./types";

// 获取设置数据
export async function getSettings(teamId: number): Promise<SettingsData> {
  // 从数据库获取团队配置
  const configs = await prisma.teamConfig.findMany({
    where: {
      teamId,
      key: {
        in: Object.values(CONFIG_KEYS),
      },
    },
  });

  // 创建一个辅助函数来获取配置值
  const getConfigValue = <T>(key: string, defaultValue: T): T => {
    const config = configs.find((c) => c.key === key);
    return config ? (config.value as T) : defaultValue;
  };

  // 合并默认设置和数据库设置
  const settings: SettingsData = {
    isTaggingEnabled: getConfigValue(
      CONFIG_KEYS.IS_TAGGING_ENABLED,
      DEFAULT_SETTINGS.isTaggingEnabled,
    ),
    taggingMode: getConfigValue(CONFIG_KEYS.TAGGING_MODE, DEFAULT_SETTINGS.taggingMode),
    recognitionAccuracy: getConfigValue(
      CONFIG_KEYS.RECOGNITION_ACCURACY,
      DEFAULT_SETTINGS.recognitionAccuracy,
    ),
    matchingSources: getConfigValue(CONFIG_KEYS.MATCHING_SOURCES, DEFAULT_SETTINGS.matchingSources),
    applicationScope: getConfigValue(
      CONFIG_KEYS.APPLICATION_SCOPE,
      DEFAULT_SETTINGS.applicationScope,
    ),
  };

  return settings;
}

// 保存设置数据
export async function saveSettings(teamId: number, data: SettingsData): Promise<void> {
  // 使用事务保存各个配置项
  await prisma.$transaction(async (tx) => {
    // 保存各个配置项到不同的 key
    const configUpdates = [
      {
        key: CONFIG_KEYS.IS_TAGGING_ENABLED,
        value: data.isTaggingEnabled,
      },
      {
        key: CONFIG_KEYS.TAGGING_MODE,
        value: data.taggingMode,
      },
      {
        key: CONFIG_KEYS.RECOGNITION_ACCURACY,
        value: data.recognitionAccuracy,
      },
      {
        key: CONFIG_KEYS.MATCHING_SOURCES,
        value: data.matchingSources,
      },
      {
        key: CONFIG_KEYS.APPLICATION_SCOPE,
        value: data.applicationScope,
      },
    ];

    // 批量更新配置
    for (const config of configUpdates) {
      await tx.teamConfig.upsert({
        where: {
          teamId_key: {
            teamId,
            key: config.key,
          },
        },
        update: {
          value: config.value,
        },
        create: {
          teamId,
          key: config.key,
          value: config.value,
        },
      });
    }
  });
}

// 重置设置为默认值
export async function resetSettings(teamId: number): Promise<SettingsData> {
  await saveSettings(teamId, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
